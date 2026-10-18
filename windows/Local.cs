// The on-PC edition. The Tuno engine runs on this PC, listens only on 127.0.0.1 and keeps its library here, so no
// server is needed. The library belongs to this PC and this Windows account: the login secret is protected by Windows
// (DPAPI), and the library folder records the PC it was made on, so a copied folder won't open somewhere else.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;
using Microsoft.Win32;

/// <summary>What starting the engine gives back: where to load the page from, and the owner's session cookie.</summary>
sealed class LocalSession
{
    public string Url;
    public string Cookie;
    public string Error;
}

static class LocalEngine
{
    // A fixed port keeps the page's address (and so its saved settings and "what's new" marker) the same between runs.
    const int PreferredPort = 47170;
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Tuno.LocalEngine.v1");
    static readonly object logGate = new object();
    static Process engine;
    static StreamWriter log;

    public static string Root { get { return Path.Combine(TunoApp.Paths.Home, "local"); } }
    static string AppDir { get { return Path.GetDirectoryName(Application.ExecutablePath); } }
    static string EngineDir { get { return Path.Combine(AppDir, "engine"); } }
    static string NodeExe { get { return Path.Combine(EngineDir, "node.exe"); } }
    static string FfmpegExe { get { return Path.Combine(EngineDir, "ffmpeg.exe"); } }
    static string YtDlpExe { get { return Path.Combine(EngineDir, "yt-dlp.exe"); } }
    static string ServerDir { get { return Path.Combine(EngineDir, "server"); } }
    static string WebDist { get { return Path.Combine(EngineDir, "web", "dist"); } }
    static string ServerScript { get { return Path.Combine(ServerDir, "dist", "index.js"); } }
    static string CliScript { get { return Path.Combine(ServerDir, "dist", "cli.js"); } }

    /// <summary>True when this copy of Tuno has its engine folder next to it.</summary>
    public static bool Installed
    {
        get
        {
            return File.Exists(NodeExe) && File.Exists(ServerScript) && File.Exists(CliScript)
                && File.Exists(YtDlpExe) && File.Exists(FfmpegExe) && File.Exists(Path.Combine(WebDist, "index.html"));
        }
    }

    /// <summary>Starts the engine, makes sure the owner's account exists, and signs in. Call it off the UI thread.</summary>
    public static LocalSession Start()
    {
        var session = new LocalSession();
        if (!Installed)
        {
            session.Error = "The engine folder is missing next to Tuno.exe. Reinstall the on-PC edition.";
            return session;
        }
        string error;
        if (!DeviceMatches(out error)) { session.Error = error; return session; }
        string password = LoadOrCreatePassword(out error);
        if (password == null) { session.Error = error; return session; }

        int port = PickPort();
        string baseUrl = "http://127.0.0.1:" + port;
        if (!Launch(port)) { session.Error = "The local engine didn't start. Its log is in " + Root + "."; return session; }
        if (!WaitForHealth(baseUrl, 30000))
        {
            Stop();
            session.Error = "The local engine didn't answer. Its log is in " + Root + ".";
            return session;
        }

        session.Cookie = Login(baseUrl, password);
        if (session.Cookie == null)
        {
            // First run on this PC: create the owner's account with the secret we just made, then sign in.
            CreateOwner(password);
            session.Cookie = Login(baseUrl, password);
        }
        if (session.Cookie == null)
        {
            Stop();
            session.Error = "Couldn't sign in to the local engine. Its log is in " + Root + ".";
            return session;
        }
        session.Url = baseUrl + "/";
        return session;
    }

    /// <summary>Stops the engine and anything it started (downloads in progress included).</summary>
    public static void Stop()
    {
        try
        {
            if (engine != null && !engine.HasExited)
            {
                var kill = Process.Start(new ProcessStartInfo("taskkill", "/PID " + engine.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                if (kill != null) kill.WaitForExit(5000);
            }
        }
        catch (Exception) { }
        engine = null;
        lock (logGate)
        {
            if (log != null) log.Dispose();
            log = null;
        }
    }

    // ---- the device lock ----

    /// <summary>The library records the PC it was made on. A folder copied from another PC is refused.</summary>
    static bool DeviceMatches(out string error)
    {
        error = null;
        string mark = Path.Combine(Root, "device.txt");
        string now = Fingerprint();
        Directory.CreateDirectory(Root);
        if (!File.Exists(mark))
        {
            File.WriteAllText(mark, now);
            return true;
        }
        if (File.ReadAllText(mark).Trim() == now) return true;
        error = "This music library was made on another PC, so it can't open here. Each library stays on the PC it was made on.";
        return false;
    }

    static string Fingerprint()
    {
        string machine = "";
        try
        {
            using (RegistryKey key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography"))
                machine = key == null ? "" : (key.GetValue("MachineGuid") as string ?? "");
        }
        catch (Exception) { }
        WindowsIdentity identity = WindowsIdentity.GetCurrent();
        string user = identity != null && identity.User != null ? identity.User.Value : "";
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(machine + "|" + user))).Replace("-", "").ToLowerInvariant();
    }

    /// <summary>The owner's secret. Windows encrypts it for this Windows account, so it can't be read on another PC.</summary>
    static string LoadOrCreatePassword(out string error)
    {
        error = null;
        string path = Path.Combine(Root, "secret.bin");
        try
        {
            if (File.Exists(path))
                return Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(path), Entropy, DataProtectionScope.CurrentUser));
            string password = RandomText(40);
            File.WriteAllBytes(path, ProtectedData.Protect(Encoding.UTF8.GetBytes(password), Entropy, DataProtectionScope.CurrentUser));
            return password;
        }
        catch (CryptographicException)
        {
            error = "Tuno can't unlock this library on this PC.";
            return null;
        }
    }

    static string RandomText(int length)
    {
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
        byte[] bytes = new byte[length];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(bytes);
        var sb = new StringBuilder(length);
        foreach (byte b in bytes) sb.Append(alphabet[b % alphabet.Length]);
        return sb.ToString();
    }

    // ---- the engine process ----

    static int PickPort()
    {
        try
        {
            var probe = new System.Net.Sockets.TcpListener(IPAddress.Loopback, PreferredPort);
            probe.Start();
            probe.Stop();
            return PreferredPort;
        }
        catch (Exception)
        {
            var any = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
            any.Start();
            int port = ((IPEndPoint)any.LocalEndpoint).Port;
            any.Stop();
            return port;
        }
    }

    /// <summary>The settings the engine needs: its own folders, the bundled tools, and a loopback-only address.</summary>
    static void EngineEnvironment(ProcessStartInfo psi)
    {
        psi.EnvironmentVariables["HOST"] = "127.0.0.1";
        psi.EnvironmentVariables["TUNO_DATA"] = Path.Combine(Root, "data");
        psi.EnvironmentVariables["TUNO_LIBRARY"] = Path.Combine(Root, "library");
        psi.EnvironmentVariables["TUNO_WEB"] = WebDist;
        psi.EnvironmentVariables["YTDLP_EXE"] = YtDlpExe;
        psi.EnvironmentVariables["YTDLP_JS_RUNTIME"] = "node:" + NodeExe;
        psi.EnvironmentVariables["FFMPEG"] = FfmpegExe;
        psi.EnvironmentVariables["NODE_ENV"] = "production";
    }

    static bool Launch(int port)
    {
        Stop();
        Directory.CreateDirectory(Path.Combine(Root, "data"));
        Directory.CreateDirectory(Path.Combine(Root, "library"));
        lock (logGate) log = new StreamWriter(Path.Combine(Root, "engine.log"), false, Encoding.UTF8) { AutoFlush = true };

        var psi = new ProcessStartInfo(NodeExe, "\"" + ServerScript + "\"")
        {
            WorkingDirectory = ServerDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        EngineEnvironment(psi);
        psi.EnvironmentVariables["PORT"] = port.ToString();
        engine = Process.Start(psi);
        if (engine == null) return false;
        engine.OutputDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
        engine.ErrorDataReceived += delegate (object s, DataReceivedEventArgs e) { Log(e.Data); };
        engine.BeginOutputReadLine();
        engine.BeginErrorReadLine();
        return true;
    }

    static bool WaitForHealth(string baseUrl, int timeoutMs)
    {
        DateTime until = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTime.UtcNow < until)
        {
            if (engine == null || engine.HasExited) return false;
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/health");
                req.Timeout = 2000;
                using (var res = (HttpWebResponse)req.GetResponse())
                    if (res.StatusCode == HttpStatusCode.OK) return true;
            }
            catch (WebException) { }
            System.Threading.Thread.Sleep(300);
        }
        return false;
    }

    /// <summary>Signs in and returns the session cookie's value, or null when the password isn't accepted.</summary>
    static string Login(string baseUrl, string password)
    {
        try
        {
            var req = (HttpWebRequest)WebRequest.Create(baseUrl + "/api/auth/login");
            req.Method = "POST";
            req.ContentType = "application/json";
            req.Timeout = 15000;
            var body = new Dictionary<string, object> { { "password", password } };
            byte[] data = Encoding.UTF8.GetBytes(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(body));
            using (Stream s = req.GetRequestStream()) s.Write(data, 0, data.Length);
            using (var res = (HttpWebResponse)req.GetResponse())
            {
                string setCookie = res.Headers["Set-Cookie"] ?? "";
                int i = setCookie.IndexOf("tuno_session=", StringComparison.Ordinal);
                if (i < 0) return null;
                int start = i + "tuno_session=".Length;
                int end = setCookie.IndexOf(';', start);
                return setCookie.Substring(start, (end < 0 ? setCookie.Length : end) - start);
            }
        }
        catch (WebException)
        {
            return null; // wrong secret, or no account yet
        }
    }

    /// <summary>Creates the owner's account in the engine's database (the password goes in on stdin, never on the command line).</summary>
    static void CreateOwner(string password)
    {
        var psi = new ProcessStartInfo(NodeExe, "\"" + CliScript + "\"")
        {
            WorkingDirectory = ServerDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        EngineEnvironment(psi);
        using (Process cli = Process.Start(psi))
        {
            var command = new Dictionary<string, object>
            {
                { "action", "add-user" },
                { "name", Environment.UserName },
                { "password", password },
                { "quotaGb", 500 },
                { "admin", true },
            };
            cli.StandardInput.Write(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(command));
            cli.StandardInput.Close();
            string output = cli.StandardOutput.ReadToEnd();
            Log("account: " + output.Trim() + " " + cli.StandardError.ReadToEnd().Trim());
            cli.WaitForExit(60000);
        }
    }

    static void Log(string line)
    {
        if (line == null) return;
        lock (logGate)
        {
            if (log != null) log.WriteLine(DateTime.Now.ToString("HH:mm:ss") + "  " + line);
        }
    }
}
