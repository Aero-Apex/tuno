// Tuno for Windows: a thin native window around the WebView2 runtime that ships with Windows,
// pointed at your own Tuno server. No bundled browser, no background services.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("Tuno")]
[assembly: AssemblyProduct("Tuno")]
[assembly: AssemblyDescription("Tuno for Windows")]

namespace TunoApp
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // The WebView2 libraries live inside this exe (compressed); load them from there.
            AppDomain.CurrentDomain.AssemblyResolve += delegate (object s, ResolveEventArgs e)
            {
                byte[] data = Embedded(new AssemblyName(e.Name).Name + ".dll");
                return data == null ? null : Assembly.Load(data);
            };
            Native.SetCurrentProcessExplicitAppUserModelID("Tuno.Desktop");

            // "--after-update" means the previous version is still shutting down: wait for it instead of treating it as a second copy.
            bool afterUpdate = Array.IndexOf(args, "--after-update") >= 0;
            string address = null;
            foreach (string a in args) if (!a.StartsWith("--")) { address = a; break; }

            bool first = false;
            Mutex mutex = null;
            for (int attempt = 0; attempt < (afterUpdate ? 30 : 1) && !first; attempt++)
            {
                if (attempt > 0) Thread.Sleep(500);
                if (mutex != null) mutex.Dispose();
                mutex = new Mutex(true, "Tuno.Desktop.SingleInstance", out first);
            }
            using (mutex)
            {
                if (!first) { FocusRunningInstance(); return; }
                Run(address);
            }
        }

        // Kept out of Main so the WebView2 types load only after the resolver above is in place.
        [MethodImpl(MethodImplOptions.NoInlining)]
        static void Run(string address)
        {
            Updater.CleanUpOldVersion();
            // A newer build downloaded earlier is installed right now, before any window shows.
            if (Settings.Get("autoUpdate") != "0" && Updater.TryApplyPending() && Updater.Restart()) return;

            UnpackLoader();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(address));
        }

        public static byte[] EmbeddedRaw(string name)
        {
            using (Stream raw = Assembly.GetExecutingAssembly().GetManifestResourceStream(name))
            using (var ms = new MemoryStream())
            {
                raw.CopyTo(ms);
                return ms.ToArray();
            }
        }

        public static byte[] Embedded(string name)
        {
            Assembly self = Assembly.GetExecutingAssembly();
            using (Stream raw = self.GetManifestResourceStream(name + ".gz"))
            {
                if (raw == null) return null;
                using (var gz = new GZipStream(raw, CompressionMode.Decompress))
                using (var ms = new MemoryStream())
                {
                    gz.CopyTo(ms);
                    return ms.ToArray();
                }
            }
        }

        /// <summary>WebView2's native loader must exist as a real file; keep one copy per build next to the app's data.</summary>
        static void UnpackLoader()
        {
            byte[] data = Embedded("WebView2Loader.dll");
            string dir = Path.Combine(Paths.Home, "bin", data.Length.ToString(CultureInfo.InvariantCulture));
            string path = Path.Combine(dir, "WebView2Loader.dll");
            if (!File.Exists(path) || new FileInfo(path).Length != data.Length)
            {
                Directory.CreateDirectory(dir);
                File.WriteAllBytes(path, data);
            }
            Native.LoadLibrary(path);
        }

        static void FocusRunningInstance()
        {
            int me = Process.GetCurrentProcess().Id;
            foreach (Process p in Process.GetProcessesByName(Process.GetCurrentProcess().ProcessName))
            {
                if (p.Id == me || p.MainWindowHandle == IntPtr.Zero) continue;
                if (Native.IsIconic(p.MainWindowHandle)) Native.ShowWindow(p.MainWindowHandle, 9); // SW_RESTORE
                Native.SetForegroundWindow(p.MainWindowHandle);
                return;
            }
        }
    }

    static class Paths
    {
        /// <summary>Where settings and the browser profile live. TUNO_HOME overrides it (handy for a portable copy).</summary>
        public static readonly string Home = Environment.GetEnvironmentVariable("TUNO_HOME")
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Tuno");
    }

    /// <summary>A tiny key=value file: the server address and the window position.</summary>
    static class Settings
    {
        static readonly string file = Path.Combine(Paths.Home, "settings.txt");
        static readonly Dictionary<string, string> values = Load();

        static Dictionary<string, string> Load()
        {
            var d = new Dictionary<string, string>();
            try
            {
                foreach (string line in File.ReadAllLines(file))
                {
                    int i = line.IndexOf('=');
                    if (i > 0) d[line.Substring(0, i).Trim()] = line.Substring(i + 1).Trim();
                }
            }
            catch { /* first run */ }
            return d;
        }

        public static string Get(string key) { string v; return values.TryGetValue(key, out v) && v.Length > 0 ? v : null; }

        public static void Set(string key, string value)
        {
            if (value == null) values.Remove(key); else values[key] = value;
            try
            {
                Directory.CreateDirectory(Paths.Home);
                var sb = new StringBuilder();
                foreach (KeyValuePair<string, string> kv in values) sb.Append(kv.Key).Append('=').Append(kv.Value).Append("\r\n");
                File.WriteAllText(file, sb.ToString());
            }
            catch { /* read-only profile: the app still works, it just won't remember */ }
        }

        public static string Server { get { return Get("server"); } set { Set("server", value); } }
    }

    /// <summary>
    /// Self-update. The server publishes a newer Tuno.exe with a checksum and an ECDSA signature made with a private key that
    /// only lives on the developer's PC; the matching public key is built into this exe. A download is used only if the checksum,
    /// the signature and the version inside the file all check out, so a hacked server or a stranger on the network can't make
    /// Tuno run their code. The file is installed when Tuno is idle or closed (Windows lets a running exe be renamed, so the
    /// swap needs no helper program).
    /// </summary>
    static class Updater
    {
        public static readonly Version Current = Normalize(Assembly.GetExecutingAssembly().GetName().Version);
        const long MaxSize = 64L * 1024 * 1024;
        static string Dir { get { return Path.Combine(Paths.Home, "update"); } }
        static string PendingExe { get { return Path.Combine(Dir, "pending.exe"); } }
        static string PendingInfo { get { return Path.Combine(Dir, "pending.txt"); } }

        public static Version Normalize(Version v) { return new Version(v.Major, v.Minor, Math.Max(v.Build, 0)); }

        /// <summary>Asks the server for the latest build and downloads it if it's newer. Returns the version that is now ready to install, or null.</summary>
        public static Version CheckAndDownload(string server, out string message)
        {
            Version result = Check(server, out message);
            try
            {
                Directory.CreateDirectory(Paths.Home);
                File.AppendAllText(Path.Combine(Paths.Home, "update.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
            }
            catch { }
            return result;
        }

        static Version Check(string server, out string message)
        {
            try
            {
                ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; // TLS 1.2
                var baseUri = new Uri(server);
                Dictionary<string, object> info = GetJson(new Uri(baseUri, "/api/app/latest?platform=windows"));
                if (info == null) { message = "Your server has no Windows update published."; return null; }

                Version latest = Normalize(Version.Parse((string)info["version"]));
                if (latest <= Current) { message = "Tuno " + Current + " is the latest version."; return null; }
                Version ready = PendingVersion();
                if (ready != null && ready >= latest) { message = "Tuno " + ready + " is ready to install."; return ready; }

                string sha = ((string)info["sha256"]).ToLowerInvariant();
                string signature = (string)info["signature"];
                long size = Convert.ToInt64(info["size"]);
                if (size <= 0 || size > MaxSize || string.IsNullOrEmpty(signature)) throw new Exception("the update's details are invalid");

                Directory.CreateDirectory(Dir);
                string part = PendingExe + ".part";
                Download(new Uri(baseUri, "/api/app/download/windows"), part, size);
                byte[] data = File.ReadAllBytes(part);
                if (data.Length != size) throw new Exception("the download is incomplete");
                if (Hex(SHA256.Create().ComputeHash(data)) != sha) throw new Exception("the download is corrupt (checksum mismatch)");
                if (!VerifySignature(data, signature)) throw new Exception("the update isn't signed with your Tuno key, so it was ignored");
                if (FileVersion(part) != latest) throw new Exception("the file isn't the version it claims to be");

                if (File.Exists(PendingExe)) File.Delete(PendingExe);
                File.Move(part, PendingExe);
                File.WriteAllText(PendingInfo, "version=" + latest + "\r\nsignature=" + signature + "\r\n");
                message = "Tuno " + latest + " has been downloaded.";
                return latest;
            }
            catch (Exception ex)
            {
                try { File.Delete(PendingExe + ".part"); } catch { }
                message = "Couldn't check for updates: " + ex.Message;
                return null;
            }
        }

        /// <summary>Version of a downloaded, verified update waiting to be installed.</summary>
        static Version PendingVersion()
        {
            try
            {
                string v = ReadInfo("version");
                return v != null && File.Exists(PendingExe) ? Normalize(Version.Parse(v)) : null;
            }
            catch { return null; }
        }

        static string ReadInfo(string key)
        {
            if (!File.Exists(PendingInfo)) return null;
            foreach (string line in File.ReadAllLines(PendingInfo))
                if (line.StartsWith(key + "=", StringComparison.Ordinal)) return line.Substring(key.Length + 1).Trim();
            return null;
        }

        /// <summary>Checks the downloaded file once more and puts it in place of the running exe. Returns false if there's nothing (valid) to install.</summary>
        public static bool TryApplyPending()
        {
            try
            {
                Version v = PendingVersion();
                if (v == null || v <= Current) return false;
                byte[] data = File.ReadAllBytes(PendingExe);
                if (!VerifySignature(data, ReadInfo("signature")) || FileVersion(PendingExe) != v)
                {
                    File.Delete(PendingExe);
                    return false;
                }
                string exe = Application.ExecutablePath, old = exe + ".old";
                if (File.Exists(old)) File.Delete(old);
                File.Move(exe, old);
                try { File.Move(PendingExe, exe); }
                catch { File.Move(old, exe); throw; }
                File.Delete(PendingInfo);
                return true;
            }
            catch { return false; } // e.g. Tuno sits in a folder it can't write to: just keep running this version
        }

        public static bool Restart()
        {
            try
            {
                Process.Start(new ProcessStartInfo(Application.ExecutablePath, "--after-update") { UseShellExecute = false });
                return true;
            }
            catch { return false; }
        }

        public static void CleanUpOldVersion()
        {
            try { File.Delete(Application.ExecutablePath + ".old"); } catch { }
        }

        static Dictionary<string, object> GetJson(Uri uri)
        {
            var req = (HttpWebRequest)WebRequest.Create(uri);
            req.Timeout = 15000;
            req.UserAgent = "Tuno-Windows/" + Current;
            try
            {
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
            }
            catch (WebException ex)
            {
                var r = ex.Response as HttpWebResponse;
                if (r != null && r.StatusCode == HttpStatusCode.NotFound) return null;
                throw;
            }
        }

        static void Download(Uri uri, string path, long expected)
        {
            var req = (HttpWebRequest)WebRequest.Create(uri);
            req.Timeout = 30000;
            req.ReadWriteTimeout = 30000;
            req.UserAgent = "Tuno-Windows/" + Current;
            using (var res = (HttpWebResponse)req.GetResponse())
            using (Stream src = res.GetResponseStream())
            using (FileStream dst = File.Create(path))
            {
                var buffer = new byte[81920];
                long total = 0;
                int n;
                while ((n = src.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += n;
                    if (total > expected) throw new Exception("the download is larger than announced");
                    dst.Write(buffer, 0, n);
                }
            }
        }

        static bool VerifySignature(byte[] data, string signatureBase64)
        {
            try
            {
                byte[] publicKey = Convert.FromBase64String(Encoding.ASCII.GetString(Program.EmbeddedRaw("update-public.key")).Trim());
                using (CngKey key = CngKey.Import(publicKey, CngKeyBlobFormat.EccPublicBlob))
                using (var ecdsa = new ECDsaCng(key))
                    return ecdsa.VerifyData(data, Convert.FromBase64String(signatureBase64), HashAlgorithmName.SHA256);
            }
            catch { return false; }
        }

        static Version FileVersion(string path)
        {
            FileVersionInfo fi = FileVersionInfo.GetVersionInfo(path);
            return new Version(fi.FileMajorPart, fi.FileMinorPart, fi.FileBuildPart);
        }

        static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    }

    static class Native
    {
        [DllImport("kernel32", CharSet = CharSet.Unicode)] public static extern IntPtr LoadLibrary(string path);
        [DllImport("kernel32")] static extern bool SetProcessWorkingSetSize(IntPtr process, IntPtr min, IntPtr max);
        [DllImport("user32")] static extern int CheckMenuItem(IntPtr menu, uint id, uint flags);

        /// <summary>Hands unused pages back to Windows (Task Manager then shows what Tuno really needs).</summary>
        public static void TrimWorkingSet()
        {
            try { SetProcessWorkingSetSize(Process.GetCurrentProcess().Handle, (IntPtr)(-1), (IntPtr)(-1)); } catch { }
        }

        public static void SetMenuCheck(IntPtr hwnd, int id, bool on)
        {
            IntPtr menu = GetSystemMenu(hwnd, false);
            if (menu != IntPtr.Zero) CheckMenuItem(menu, (uint)id, on ? 0x8u : 0u); // MF_BYCOMMAND | MF_CHECKED / MF_UNCHECKED
        }

        [DllImport("shell32", CharSet = CharSet.Unicode)] public static extern int SetCurrentProcessExplicitAppUserModelID(string id);
        [DllImport("dwmapi")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        [DllImport("user32")] static extern IntPtr GetSystemMenu(IntPtr hwnd, bool revert);
        [DllImport("user32", CharSet = CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu, uint flags, UIntPtr id, string text);
        [DllImport("user32")] public static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("user32")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
        [DllImport("user32")] public static extern bool IsIconic(IntPtr hwnd);

        /// <summary>Dark title bar to match the app (Windows 10 20H1+; the caption colour needs Windows 11, older builds ignore both).</summary>
        public static void DarkTitleBar(IntPtr hwnd)
        {
            int on = 1, caption = 0x121212, text = 0xFFFFFF;
            DwmSetWindowAttribute(hwnd, 20, ref on, 4);
            DwmSetWindowAttribute(hwnd, 19, ref on, 4);
            DwmSetWindowAttribute(hwnd, 35, ref caption, 4);
            DwmSetWindowAttribute(hwnd, 36, ref text, 4);
        }

        public static void AddSystemMenuItems(IntPtr hwnd, params KeyValuePair<int, string>[] items)
        {
            IntPtr menu = GetSystemMenu(hwnd, false);
            if (menu == IntPtr.Zero) return;
            AppendMenu(menu, 0x800, UIntPtr.Zero, null); // separator
            foreach (KeyValuePair<int, string> item in items) AppendMenu(menu, 0, (UIntPtr)(uint)item.Key, item.Value);
        }
    }

    sealed class MainForm : Form
    {
        const int CmdChangeServer = 0x1010, CmdReload = 0x1020, CmdCheckUpdate = 0x1030, CmdAutoUpdate = 0x1040;
        // Autoplay: a music app starts the next song without a click. The rest keeps the profile small.
        const string BrowserArgs = "--autoplay-policy=no-user-gesture-required --disable-features=Translate,msEdgeShoppingUI,msEdgeFollow";
        static readonly Color Back = Color.FromArgb(18, 18, 18);

        readonly WebView2 web = new WebView2();
        readonly string address;
        readonly System.Windows.Forms.Timer tick = new System.Windows.Forms.Timer { Interval = 30000 };
        string server;
        bool fullscreen, checking, pendingReady, suspending, trimmed;
        int idleTicks;
        DateTime lastCheck = DateTime.MinValue;
        Rectangle windowedBounds;
        FormWindowState windowedState;
        FormBorderStyle windowedBorder;

        static bool AutoUpdate { get { return Settings.Get("autoUpdate") != "0"; } }

        public MainForm(string address)
        {
            this.address = address;
            tick.Tick += OnTick;
            Text = "Tuno";
            BackColor = Back;
            MinimumSize = new Size(380, 520);
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("tuno.ico"))
                if (s != null) Icon = new Icon(s);

            RestoreWindow();

            web.Dock = DockStyle.Fill;
            web.DefaultBackgroundColor = Back; // no white flash while the page loads
            web.CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = Path.Combine(Paths.Home, "WebView2"),
                AdditionalBrowserArguments = BrowserArgs + " " + (Settings.Get("extraBrowserArgs") ?? ""),
            };
            Controls.Add(web);
            Shown += delegate { Begin(); };
        }

        // ---- window ----

        void RestoreWindow()
        {
            StartPosition = FormStartPosition.Manual;
            Size = new Size(1280, 820);
            try
            {
                string[] p = (Settings.Get("bounds") ?? "").Split(',');
                var r = new Rectangle(int.Parse(p[0]), int.Parse(p[1]), int.Parse(p[2]), int.Parse(p[3]));
                bool visible = false;
                foreach (Screen sc in Screen.AllScreens) if (sc.WorkingArea.IntersectsWith(r)) visible = true;
                if (visible && r.Width >= 380 && r.Height >= 520) Bounds = r; else StartPosition = FormStartPosition.CenterScreen;
                if (Settings.Get("maximized") == "1") WindowState = FormWindowState.Maximized;
            }
            catch { StartPosition = FormStartPosition.CenterScreen; }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Native.DarkTitleBar(Handle);
            Native.AddSystemMenuItems(Handle,
                new KeyValuePair<int, string>(CmdReload, "Reload\tF5"),
                new KeyValuePair<int, string>(CmdChangeServer, "Change server..."),
                new KeyValuePair<int, string>(CmdCheckUpdate, "Check for updates (v" + Updater.Current + ")"),
                new KeyValuePair<int, string>(CmdAutoUpdate, "Update automatically"));
            Native.SetMenuCheck(Handle, CmdAutoUpdate, AutoUpdate);
        }

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == 0x112) // WM_SYSCOMMAND
            {
                int cmd = (int)m.WParam & 0xFFF0;
                if (cmd == CmdChangeServer) { ChangeServer(); return; }
                if (cmd == CmdReload) { if (web.CoreWebView2 != null) Navigate(); return; }
                if (cmd == CmdCheckUpdate) { StartUpdateCheck(true); return; }
                if (cmd == CmdAutoUpdate)
                {
                    Settings.Set("autoUpdate", AutoUpdate ? "0" : "1");
                    Native.SetMenuCheck(Handle, CmdAutoUpdate, AutoUpdate);
                    return;
                }
            }
            base.WndProc(ref m);
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            bool minimized = WindowState == FormWindowState.Minimized;
            // A minimized music player doesn't need its page cached in memory: let WebView2 trim it (audio keeps playing).
            try
            {
                if (web.CoreWebView2 != null)
                    web.CoreWebView2.MemoryUsageTargetLevel = minimized ? CoreWebView2MemoryUsageTargetLevel.Low : CoreWebView2MemoryUsageTargetLevel.Normal;
            }
            catch { }
            if (minimized) Native.TrimWorkingSet(); else ResumeWeb();
        }

        protected override void OnFormClosed(FormClosedEventArgs e)
        {
            base.OnFormClosed(e);
            tick.Stop();
            if (AutoUpdate) Updater.TryApplyPending(); // a downloaded update goes in when Tuno closes, so the next start is the new version
        }

        // ---- idle work: updates, and putting a hidden player to sleep ----

        void OnTick(object sender, EventArgs e)
        {
            CoreWebView2 core = web.CoreWebView2;
            if (core == null) return;
            bool playing = false;
            try { playing = core.IsDocumentPlayingAudio; } catch { }

            if (!trimmed) { trimmed = true; Native.TrimWorkingSet(); }

            if (AutoUpdate && !checking && DateTime.UtcNow - lastCheck > TimeSpan.FromHours(6)) StartUpdateCheck(false);

            // Update installs without interrupting music: once nothing has played for a minute, restart into the new version.
            if (pendingReady && AutoUpdate)
            {
                idleTicks = playing ? 0 : idleTicks + 1;
                if (idleTicks >= 2) { RestartIntoUpdate(); return; }
            }

            // A minimized window that isn't playing doesn't need a running page at all.
            if (WindowState == FormWindowState.Minimized && !playing) TrySuspendWeb();
        }

        async void TrySuspendWeb()
        {
            CoreWebView2 core = web.CoreWebView2;
            if (core == null || suspending || core.IsSuspended) return;
            suspending = true;
            try
            {
                web.Visible = false; // WebView2 can only sleep while hidden
                if (!await core.TrySuspendAsync()) web.Visible = true;
            }
            catch { web.Visible = true; }
            finally { suspending = false; }
        }

        void ResumeWeb()
        {
            CoreWebView2 core = web.CoreWebView2;
            if (core == null) return;
            try
            {
                web.Visible = true;
                if (core.IsSuspended) core.Resume();
            }
            catch { }
        }

        void StartUpdateCheck(bool manual)
        {
            if (checking || server == null) return;
            checking = true;
            string target = server;
            Task.Run(delegate
            {
                string message;
                Version found = Updater.CheckAndDownload(target, out message);
                try
                {
                    BeginInvoke((Action)delegate
                    {
                        checking = false;
                        // A failed check (server asleep, VPN off) is retried in half an hour; a good one in six hours.
                        lastCheck = found != null || message.StartsWith("Tuno ") ? DateTime.UtcNow : DateTime.UtcNow - TimeSpan.FromHours(5.5);
                        if (found != null) pendingReady = true;
                        if (manual) ShowUpdateResult(found, message);
                    });
                }
                catch (InvalidOperationException) { /* window closed meanwhile */ }
            });
        }

        void ShowUpdateResult(Version found, string message)
        {
            if (found != null && MessageBox.Show(this, "Tuno " + found + " is ready. Restart now to install it?", "Tuno",
                    MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                RestartIntoUpdate();
            else if (found == null)
                MessageBox.Show(this, message, "Tuno", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        void RestartIntoUpdate()
        {
            tick.Stop();
            if (Updater.TryApplyPending())
            {
                Updater.Restart();
                Close();
            }
            else
            {
                pendingReady = false;
                tick.Start();
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            base.OnFormClosing(e);
            Rectangle b = fullscreen ? windowedBounds : (WindowState == FormWindowState.Normal ? Bounds : RestoreBounds);
            FormWindowState st = fullscreen ? windowedState : WindowState;
            Settings.Set("bounds", string.Join(",", b.X, b.Y, b.Width, b.Height));
            Settings.Set("maximized", st == FormWindowState.Maximized ? "1" : "0");
        }

        void SetFullscreen(bool on)
        {
            if (on == fullscreen) return;
            fullscreen = on;
            if (on)
            {
                windowedBorder = FormBorderStyle;
                windowedState = WindowState;
                windowedBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
                FormBorderStyle = FormBorderStyle.None;
                WindowState = FormWindowState.Normal;
                Bounds = Screen.FromControl(this).Bounds;
            }
            else
            {
                FormBorderStyle = windowedBorder;
                Bounds = windowedBounds;
                WindowState = windowedState;
            }
        }

        // ---- web view ----

        async void Begin()
        {
            try
            {
                string fromArgs = NormalizeUrl(address);
                if (fromArgs != null) Settings.Server = fromArgs;
                server = Settings.Server;
                if (server == null)
                {
                    server = AskServer(this, null);
                    if (server == null) { Close(); return; }
                    Settings.Server = server;
                }

                await web.EnsureCoreWebView2Async();
                Configure(web.CoreWebView2);
                Navigate();
                tick.Start();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                if (MessageBox.Show(this, "Tuno needs the Microsoft Edge WebView2 Runtime, which is free and small. Open the download page?",
                    "Tuno", MessageBoxButtons.YesNo, MessageBoxIcon.Information) == DialogResult.Yes)
                    OpenExternal("https://developer.microsoft.com/microsoft-edge/webview2/");
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Tuno couldn't start its web view:\n\n" + ex.Message, "Tuno", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

        void Configure(CoreWebView2 core)
        {
            CoreWebView2Settings st = core.Settings;
            st.AreDevToolsEnabled = false;
            st.IsStatusBarEnabled = false;
            st.IsPasswordAutosaveEnabled = false;
            st.IsGeneralAutofillEnabled = false;
            st.IsSwipeNavigationEnabled = false;
            st.IsPinchZoomEnabled = false;
            try { core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Dark; } catch { }

            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += delegate (object s, CoreWebView2NewWindowRequestedEventArgs e)
            {
                e.Handled = true;
                if (SameOrigin(e.Uri)) core.Navigate(e.Uri); else OpenExternal(e.Uri);
            };
            core.DocumentTitleChanged += delegate
            {
                string t = core.DocumentTitle;
                Text = string.IsNullOrWhiteSpace(t) || t.StartsWith("data:") || t == "about:blank" ? "Tuno" : t;
            };
            core.ContainsFullScreenElementChanged += delegate { SetFullscreen(core.ContainsFullScreenElement); };
            core.ProcessFailed += OnProcessFailed;
            core.WebMessageReceived += delegate (object s, CoreWebView2WebMessageReceivedEventArgs e)
            {
                string msg;
                try { msg = e.TryGetWebMessageAsString(); } catch { return; }
                if (msg == "change-server") ChangeServer();
                else if (msg == "fullscreen") SetFullscreen(!fullscreen);
            };
            // F11 toggles fullscreen (WebView2's WinForms control doesn't surface key events, so ask the page).
            core.AddScriptToExecuteOnDocumentCreatedAsync(
                "addEventListener('keydown',function(e){if(e.key==='F11'){e.preventDefault();chrome.webview.postMessage('fullscreen');}},true);");
        }

        void Navigate()
        {
            try { web.CoreWebView2.Navigate(server); } catch { ShowOffline(); }
        }

        void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess) return;
            switch (e.WebErrorStatus)
            {
                case CoreWebView2WebErrorStatus.CannotConnect:
                case CoreWebView2WebErrorStatus.HostNameNotResolved:
                case CoreWebView2WebErrorStatus.ConnectionAborted:
                case CoreWebView2WebErrorStatus.ConnectionReset:
                case CoreWebView2WebErrorStatus.Disconnected:
                case CoreWebView2WebErrorStatus.ServerUnreachable:
                case CoreWebView2WebErrorStatus.Timeout:
                    ShowOffline();
                    break;
            }
        }

        void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            switch (e.ProcessFailedKind)
            {
                case CoreWebView2ProcessFailedKind.RenderProcessExited:
                case CoreWebView2ProcessFailedKind.RenderProcessUnresponsive:
                    BeginInvoke((Action)delegate { web.Reload(); });
                    break;
                case CoreWebView2ProcessFailedKind.BrowserProcessExited:
                    BeginInvoke((Action)delegate
                    {
                        MessageBox.Show(this, "The web view stopped unexpectedly. Open Tuno again to continue.", "Tuno", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        Close();
                    });
                    break;
            }
        }

        void ChangeServer()
        {
            string next = AskServer(this, server);
            if (next == null || next == server) return;
            server = next;
            Settings.Server = next;
            if (web.CoreWebView2 != null) Navigate();
        }

        void ShowOffline()
        {
            string js = server.Replace("\\", "\\\\").Replace("'", "\\'").Replace("<", "\\x3c");
            string html =
                "<!doctype html><meta charset=utf-8><title>Tuno</title><style>" +
                "html,body{height:100%;margin:0;background:#121212;color:#fff;font:15px 'Segoe UI',system-ui,sans-serif}" +
                "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;box-sizing:border-box}" +
                "h1{font-size:26px;margin:0}p{color:#b3b3b3;margin:0;max-width:440px;line-height:1.5}code{color:#fff}" +
                "div{display:flex;gap:10px;margin-top:10px}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 22px;cursor:pointer;background:#1ed760;color:#000}" +
                "button.alt{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px #7c7c7c}</style>" +
                "<h1>Can't reach your Tuno server</h1>" +
                "<p><code>" + WebUtility.HtmlEncode(server) + "</code></p>" +
                "<p>Check that it's running and that this PC is on the same network (or connected to your VPN). Tuno keeps trying and opens as soon as it answers.</p>" +
                "<div><button onclick=\"location.replace('" + js + "')\">Try again</button>" +
                "<button class=alt onclick=\"chrome.webview.postMessage('change-server')\">Change server</button></div>" +
                "<script>var u='" + js + "';setInterval(function(){fetch(u,{mode:'no-cors',cache:'no-store'}).then(function(){location.replace(u)},function(){})},4000)</script>";
            try { web.NavigateToString(html); } catch { }
        }

        bool SameOrigin(string url)
        {
            Uri a, b;
            return Uri.TryCreate(url, UriKind.Absolute, out a) && Uri.TryCreate(server, UriKind.Absolute, out b)
                && a.Scheme == b.Scheme && a.Host == b.Host && a.Port == b.Port;
        }

        static void OpenExternal(string url)
        {
            Uri u;
            if (!Uri.TryCreate(url, UriKind.Absolute, out u)) return;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeMailto) return;
            try { Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true }); } catch { }
        }

        // ---- server address ----

        /// <summary>Turns "192.168.1.5:7070" or "https://music.example.com/" into a usable http(s) address, or null.</summary>
        public static string NormalizeUrl(string text)
        {
            if (text == null) return null;
            text = text.Trim();
            if (text.Length == 0) return null;
            if (text.IndexOf("://", StringComparison.Ordinal) < 0) text = "http://" + text;
            Uri u;
            if (!Uri.TryCreate(text, UriKind.Absolute, out u)) return null;
            if (u.Scheme != Uri.UriSchemeHttp && u.Scheme != Uri.UriSchemeHttps) return null;
            return u.AbsoluteUri;
        }

        static string AskServer(IWin32Window owner, string current)
        {
            using (var f = new Form())
            {
                var label = new Label
                {
                    Text = "Address of your Tuno server, for example http://192.168.1.50:7070 or https://music.example.com",
                    AutoSize = true, MaximumSize = new Size(420, 0), Margin = new Padding(0, 0, 0, 10),
                };
                var box = new TextBox
                {
                    Text = current ?? "http://", Width = 420, BorderStyle = BorderStyle.FixedSingle,
                    BackColor = Color.FromArgb(42, 42, 42), ForeColor = Color.White, Margin = new Padding(0, 0, 0, 4),
                };
                var error = new Label { Text = "", AutoSize = true, ForeColor = Color.FromArgb(241, 94, 108), Margin = new Padding(0, 0, 0, 8) };
                var ok = new Button { Text = "Connect", DialogResult = DialogResult.OK, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(30, 215, 96), ForeColor = Color.Black, AutoSize = true, Padding = new Padding(10, 2, 10, 2) };
                var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, FlatStyle = FlatStyle.Flat, BackColor = Color.FromArgb(42, 42, 42), ForeColor = Color.White, AutoSize = true, Padding = new Padding(10, 2, 10, 2) };
                ok.FlatAppearance.BorderSize = 0;
                cancel.FlatAppearance.BorderSize = 0;
                var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill, Margin = new Padding(0) };
                buttons.Controls.Add(ok);
                buttons.Controls.Add(cancel);

                var layout = new TableLayoutPanel { ColumnCount = 1, AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(18) };
                layout.Controls.Add(label);
                layout.Controls.Add(box);
                layout.Controls.Add(error);
                layout.Controls.Add(buttons);

                f.Text = "Tuno server";
                f.Font = new Font("Segoe UI", 9f);
                f.AutoScaleMode = AutoScaleMode.Dpi;
                f.AutoScaleDimensions = new SizeF(96f, 96f);
                f.BackColor = Color.FromArgb(24, 24, 24);
                f.ForeColor = Color.White;
                f.FormBorderStyle = FormBorderStyle.FixedDialog;
                f.MaximizeBox = f.MinimizeBox = false;
                f.ShowInTaskbar = false;
                f.StartPosition = owner == null ? FormStartPosition.CenterScreen : FormStartPosition.CenterParent;
                f.AutoSize = true;
                f.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                f.AcceptButton = ok;
                f.CancelButton = cancel;
                f.Controls.Add(layout);
                f.HandleCreated += delegate { Native.DarkTitleBar(f.Handle); };
                f.Shown += delegate { box.Focus(); box.SelectionStart = box.TextLength; };
                string result = null;
                f.FormClosing += delegate (object s, FormClosingEventArgs e)
                {
                    if (f.DialogResult != DialogResult.OK) return;
                    result = NormalizeUrl(box.Text);
                    if (result == null) { error.Text = "That doesn't look like a web address."; e.Cancel = true; }
                };
                return f.ShowDialog(owner) == DialogResult.OK ? result : null;
            }
        }
    }
}
