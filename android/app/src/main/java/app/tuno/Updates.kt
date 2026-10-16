package app.tuno

import android.app.Application
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import okhttp3.CacheControl
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

class UpdateInfo(val version: String, val versionCode: Long, val sha256: String, val size: Long, val url: String, val notes: String?)

sealed interface UpdateState {
    data object Idle : UpdateState
    data object Checking : UpdateState
    data object UpToDate : UpdateState
    data class Downloading(val info: UpdateInfo, val progress: Float) : UpdateState
    /** Downloaded and verified, waiting for a quiet moment (no music playing) to install. */
    data class Ready(val info: UpdateInfo, val file: File) : UpdateState
    /** Android needs a one-time "allow Tuno to install apps" switch before it will take updates. */
    data class NeedsPermission(val info: UpdateInfo, val file: File) : UpdateState
    data class Installing(val info: UpdateInfo) : UpdateState
    /** Android wants a tap on its own "Update this app?" screen (it asks for the first update from a new installer). */
    data class NeedsConfirm(val info: UpdateInfo, val intent: Intent) : UpdateState
    data class Failed(val message: String) : UpdateState
}

/**
 * Keeps Tuno up to date by itself. Your server publishes new builds (scripts/publish-update.ps1); this looks for one when
 * the app opens (at most every 6 hours), downloads it in the background, checks the file against its checksum and against
 * the certificate this app is signed with (Android would refuse a differently signed APK anyway), and installs it
 * through the system installer as soon as no music is playing. Android 12 and newer can install updates without
 * asking again; older versions, and the first update, show the system's own confirmation screen.
 */
class UpdateManager(private val app: Application, private val api: Api, private val prefs: Prefs) {
    var state: UpdateState by mutableStateOf(UpdateState.Idle)
        private set

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var work: Job? = null
    private val dir get() = File(app.cacheDir, "update")

    var auto by mutableStateOf(prefs.autoUpdate)
        private set

    fun enableAuto(on: Boolean) {
        auto = on
        prefs.autoUpdate = on
        if (on) checkIfDue()
    }

    fun checkIfDue() {
        if (auto && System.currentTimeMillis() - prefs.lastUpdateCheck > CHECK_EVERY_MS) checkForUpdate(manual = false)
    }

    /** Looks for a newer build and downloads it. [manual] checks report "up to date" and errors; automatic ones stay quiet. */
    fun checkForUpdate(manual: Boolean) {
        if (work?.isActive == true) return
        when (state) {
            is UpdateState.Ready, is UpdateState.NeedsPermission, is UpdateState.Installing, is UpdateState.NeedsConfirm -> return
            else -> Unit
        }
        work = scope.launch {
            state = UpdateState.Checking
            try {
                val info = fetchLatest()
                prefs.lastUpdateCheck = System.currentTimeMillis()
                if (info == null || info.versionCode <= BuildConfig.VERSION_CODE) {
                    state = UpdateState.UpToDate
                    cleanUp()
                    return@launch
                }
                state = UpdateState.Ready(info, download(info))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                // A server that's asleep or off the VPN is retried in half an hour rather than in six.
                prefs.lastUpdateCheck = System.currentTimeMillis() - CHECK_EVERY_MS + 30 * 60_000
                state = if (manual) UpdateState.Failed(e.message ?: "Couldn't check for updates") else UpdateState.Idle
            }
        }
    }

    /** Called when nothing is playing (and when the app opens): installs a downloaded update. */
    fun installIfIdle(playing: Boolean) {
        if (auto && !playing && state is UpdateState.Ready) install()
    }

    /** Starts installing the downloaded update now (the "Install now" button, and the automatic path). */
    fun install() {
        val (info, file) = when (val s = state) {
            is UpdateState.Ready -> s.info to s.file
            is UpdateState.NeedsPermission -> s.info to s.file
            else -> return
        }
        if (!app.packageManager.canRequestPackageInstalls()) {
            state = UpdateState.NeedsPermission(info, file)
            return
        }
        state = UpdateState.Installing(info)
        scope.launch {
            try {
                commit(file)
            } catch (e: Exception) {
                state = UpdateState.Failed("Couldn't install the update: ${e.message}")
            }
        }
    }

    /** The system page where the person lets Tuno install apps (needed once, before the first update). */
    fun permissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${app.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    /** The app came back to the screen: finish anything that was waiting for the person. */
    fun onResumed(context: Context) {
        when (val s = state) {
            is UpdateState.NeedsPermission -> if (app.packageManager.canRequestPackageInstalls()) install()
            is UpdateState.NeedsConfirm -> launchConfirm(context, s)
            else -> Unit
        }
    }

    private fun launchConfirm(context: Context, s: UpdateState.NeedsConfirm) {
        try {
            context.startActivity(Intent(s.intent).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
            // Can't open it from the background: it opens the next time the app is in front.
        }
    }

    internal fun onInstallStatus(context: Context, status: Int, message: String?, confirm: Intent?) {
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val info = (state as? UpdateState.Installing)?.info ?: return
                if (confirm == null) return
                val s = UpdateState.NeedsConfirm(info, confirm)
                state = s
                launchConfirm(context, s)
            }
            PackageInstaller.STATUS_SUCCESS -> Unit // the app is replaced and restarted by Android
            PackageInstaller.STATUS_FAILURE_ABORTED -> state = UpdateState.Failed("The update was cancelled.")
            else -> state = UpdateState.Failed(message ?: "The update couldn't be installed ($status).")
        }
    }

    // ---- steps ----

    private fun fetchLatest(): UpdateInfo? {
        val req = Request.Builder().url("${api.server}/api/app/latest?platform=android").cacheControl(CacheControl.FORCE_NETWORK).build()
        api.client.newCall(req).execute().use { res ->
            if (res.code == 404) return null
            if (!res.isSuccessful) error("The server answered ${res.code}")
            val o = JSONObject(res.body?.string().orEmpty())
            return UpdateInfo(
                version = o.getString("version"),
                versionCode = o.getLong("versionCode"),
                sha256 = o.getString("sha256").lowercase(),
                size = o.getLong("size"),
                url = o.getString("url"),
                notes = o.optString("notes").ifBlank { null },
            )
        }
    }

    private fun download(info: UpdateInfo): File {
        require(info.size in 1..MAX_SIZE) { "The update's details are invalid." }
        dir.mkdirs()
        val file = File(dir, "Tuno-${info.versionCode}.apk")
        if (file.exists() && file.length() == info.size && sha256(file) == info.sha256 && verify(file, info)) return file

        val part = File(dir, "${file.name}.part")
        val req = Request.Builder().url(api.server + info.url).cacheControl(CacheControl.Builder().noStore().build()).build()
        val digest = MessageDigest.getInstance("SHA-256")
        api.client.newCall(req).execute().use { res ->
            if (!res.isSuccessful) error("The download failed (${res.code})")
            val body = res.body ?: error("The download was empty")
            var done = 0L
            var shown = 0L
            body.byteStream().use { input ->
                part.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        done += n
                        if (done > info.size) error("The download is larger than announced")
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        if (done - shown > 128 * 1024) {
                            shown = done
                            state = UpdateState.Downloading(info, done.toFloat() / info.size)
                        }
                    }
                }
            }
        }
        if (part.length() != info.size) { part.delete(); error("The download is incomplete") }
        if (digest.digest().toHex() != info.sha256) { part.delete(); error("The download is corrupt (checksum mismatch)") }
        if (!verify(part, info)) { part.delete(); error("The update isn't signed like this app, so it was ignored") }
        file.delete()
        check(part.renameTo(file)) { "Couldn't save the update" }
        return file
    }

    /** The file must be this app, the version it claims (and newer than ours), signed by the same certificate as the installed copy. */
    private fun verify(file: File, info: UpdateInfo): Boolean = runCatching {
        val pm = app.packageManager
        val flags = if (Build.VERSION.SDK_INT >= 28) PackageManager.GET_SIGNING_CERTIFICATES else @Suppress("DEPRECATION") PackageManager.GET_SIGNATURES
        val archive = pm.getPackageArchiveInfo(file.path, flags) ?: return false
        if (archive.packageName != app.packageName) return false
        @Suppress("DEPRECATION") val code = if (Build.VERSION.SDK_INT >= 28) archive.longVersionCode else archive.versionCode.toLong()
        if (code != info.versionCode || code <= BuildConfig.VERSION_CODE) return false
        val mine = signers(pm.getPackageInfo(app.packageName, flags))
        val theirs = signers(archive)
        mine.isNotEmpty() && mine == theirs
    }.getOrDefault(false)

    private fun signers(p: PackageInfo): Set<String> {
        val certs = if (Build.VERSION.SDK_INT >= 28) p.signingInfo?.apkContentsSigners else @Suppress("DEPRECATION") p.signatures
        return certs.orEmpty().map { MessageDigest.getInstance("SHA-256").digest(it.toByteArray()).toHex() }.toSet()
    }

    private fun commit(file: File) {
        val installer = app.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(app.packageName)
            // Android 12+: an app updated by its own installer may be updated without another confirmation.
            if (Build.VERSION.SDK_INT >= 31) setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            file.inputStream().use { input ->
                session.openWrite("tuno.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
            val pending = PendingIntent.getBroadcast(app, id, Intent(app, InstallReceiver::class.java).setPackage(app.packageName), flags)
            session.commit(pending.intentSender)
        }
    }

    private fun cleanUp() {
        dir.listFiles()?.forEach { it.delete() }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        return digest.digest().toHex()
    }

    private fun ByteArray.toHex() = joinToString("") { "%02x".format(it) }

    private companion object {
        const val CHECK_EVERY_MS = 6 * 3_600_000L
        const val MAX_SIZE = 100L * 1024 * 1024
    }
}

/** Receives the system installer's progress for the update session and hands it to [UpdateManager]. */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val updates = (context.applicationContext as TunoApp).updates
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
        @Suppress("DEPRECATION")
        val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra(Intent.EXTRA_INTENT)
        updates.onInstallStatus(context, status, message, confirm)
    }
}
