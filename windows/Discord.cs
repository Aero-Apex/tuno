// Shows what Tuno is playing on the user's Discord profile ("Listening to Tuno"), the way Spotify does.
// It talks to the Discord desktop app over Discord's local pipe, with the app's Client ID. No token or secret is
// needed, and nothing is sent anywhere except to the Discord app already running on this PC.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

sealed class DiscordPresence : IDisposable
{
    const string ClientId = "1561445740109234301";
    const int ReplyTimeoutMs = 2000;

    readonly object gate = new object();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    NamedPipeClientStream pipe;
    DateTime retryAfter = DateTime.MinValue;
    bool shown;

    /// <summary>Shows "Listening to Tuno" with the track and a progress bar. Quietly does nothing when Discord isn't running.</summary>
    public void Show(string title, string artist, double position, double duration)
    {
        var activity = new Dictionary<string, object>();
        activity["type"] = 2; // "Listening to ..."
        activity["details"] = Fit(title, "Tuno");
        if (!string.IsNullOrEmpty(artist)) activity["state"] = Fit("by " + artist, "by Tuno");
        activity["instance"] = false;
        if (duration > 0)
        {
            long now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            long start = now - (long)Math.Max(0, position);
            activity["timestamps"] = new Dictionary<string, object> { { "start", start }, { "end", start + (long)duration } };
        }
        Send(activity);
    }

    /// <summary>Removes the status.</summary>
    public void Clear()
    {
        Send(null);
    }

    void Send(Dictionary<string, object> activity)
    {
        lock (gate)
        {
            if (activity == null && !shown) return;
            if (!EnsureConnected()) return;
            try
            {
                var args = new Dictionary<string, object>();
                args["pid"] = Process.GetCurrentProcess().Id;
                args["activity"] = activity;
                var frame = new Dictionary<string, object>();
                frame["cmd"] = "SET_ACTIVITY";
                frame["args"] = args;
                frame["nonce"] = Guid.NewGuid().ToString();
                Write(1, json.Serialize(frame));
                ReadFrame(); // Discord answers every command; the answer isn't needed
                shown = activity != null;
            }
            catch (Exception)
            {
                Drop();
            }
        }
    }

    bool EnsureConnected()
    {
        if (pipe != null && pipe.IsConnected) return true;
        if (DateTime.UtcNow < retryAfter) return false;
        Drop();
        for (int i = 0; i < 10; i++)
        {
            var candidate = new NamedPipeClientStream(".", "discord-ipc-" + i, PipeDirection.InOut);
            try
            {
                candidate.Connect(200);
                pipe = candidate;
                var hello = new Dictionary<string, object>();
                hello["v"] = 1;
                hello["client_id"] = ClientId;
                Write(0, json.Serialize(hello));
                ReadFrame(); // READY
                return true;
            }
            catch (Exception)
            {
                candidate.Dispose();
                pipe = null;
            }
        }
        // Discord isn't running. Look again in fifteen seconds, not on every track change.
        retryAfter = DateTime.UtcNow.AddSeconds(15);
        return false;
    }

    void Write(int opcode, string payload)
    {
        byte[] body = Encoding.UTF8.GetBytes(payload);
        byte[] head = new byte[8];
        BitConverter.GetBytes(opcode).CopyTo(head, 0);
        BitConverter.GetBytes(body.Length).CopyTo(head, 4);
        pipe.Write(head, 0, head.Length);
        pipe.Write(body, 0, body.Length);
        pipe.Flush();
    }

    string ReadFrame()
    {
        byte[] head = ReadWithTimeout(8);
        int length = BitConverter.ToInt32(head, 4);
        if (length < 0 || length > 1 << 20) throw new IOException("Discord sent an odd reply");
        return Encoding.UTF8.GetString(ReadWithTimeout(length));
    }

    byte[] ReadWithTimeout(int count)
    {
        NamedPipeClientStream p = pipe;
        Task<byte[]> read = Task.Run(() => ReadExactly(p, count));
        if (!read.Wait(ReplyTimeoutMs)) throw new TimeoutException("Discord didn't answer");
        return read.Result;
    }

    static byte[] ReadExactly(Stream s, int count)
    {
        byte[] buffer = new byte[count];
        int got = 0;
        while (got < count)
        {
            int n = s.Read(buffer, got, count - got);
            if (n <= 0) throw new IOException("Discord closed the pipe");
            got += n;
        }
        return buffer;
    }

    void Drop()
    {
        if (pipe != null) pipe.Dispose();
        pipe = null;
        shown = false;
    }

    static string Fit(string text, string fallback)
    {
        string t = (text ?? "").Trim();
        if (t.Length < 2) return fallback;
        return t.Length > 128 ? t.Substring(0, 125) + "..." : t;
    }

    public void Dispose()
    {
        lock (gate)
        {
            try { if (shown) Send(null); } catch (Exception) { }
            Drop();
        }
    }
}
