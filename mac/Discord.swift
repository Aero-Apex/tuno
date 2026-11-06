// Shows what Tuno is playing on the user's Discord profile ("Listening to Tuno"), the way Spotify does.
// It talks to the Discord desktop app over Discord's local socket, with the app's Client ID. No token or secret is
// needed, and nothing is sent anywhere except to the Discord app already running on this Mac.
// Same protocol as windows/Discord.cs: frames of [opcode int32 LE][length int32 LE][JSON].
import Foundation

final class DiscordPresence {
    private let clientId = "1561445740109234301"
    /// All socket work happens here, one piece after another, never on the main thread.
    private let queue = DispatchQueue(label: "app.tuno.discord")
    private var fd: Int32 = -1
    private var retryAfter = Date.distantPast
    private var shown = false

    /// Shows "Listening to Tuno" with the track and a progress bar. Quietly does nothing when Discord isn't running.
    func show(title: String, artist: String, position: Double, duration: Double) {
        var activity: [String: Any] = ["type": 2, "details": fit(title, "Tuno"), "instance": false]
        if !artist.isEmpty { activity["state"] = fit("by " + artist, "by Tuno") }
        if duration > 0 {
            let start = Int(Date().timeIntervalSince1970) - Int(max(0, position))
            activity["timestamps"] = ["start": start, "end": start + Int(duration)]
        }
        queue.async { self.send(activity) }
    }

    /// Removes the status.
    func clear() {
        queue.async { self.send(nil) }
    }

    private func send(_ activity: [String: Any]?) {
        if activity == nil && !shown { return }
        guard ensureConnected() else { return }
        var args: [String: Any] = ["pid": Int(getpid())]
        args["activity"] = activity.map { $0 as Any } ?? NSNull()
        let frame: [String: Any] = ["cmd": "SET_ACTIVITY", "args": args, "nonce": UUID().uuidString]
        // Discord answers every command; the answer itself isn't needed.
        if writeFrame(op: 1, frame) && readFrame() { shown = activity != nil } else { drop() }
    }

    private func ensureConnected() -> Bool {
        if fd >= 0 { return true }
        if Date() < retryAfter { return false }
        let env = ProcessInfo.processInfo.environment
        let folders = [env["XDG_RUNTIME_DIR"], env["TMPDIR"], env["TMP"], env["TEMP"], "/tmp"].compactMap { $0 }
        for folder in folders {
            for i in 0..<10 {
                let path = (folder as NSString).appendingPathComponent("discord-ipc-\(i)")
                guard FileManager.default.fileExists(atPath: path), open(path) else { continue }
                if writeFrame(op: 0, ["v": 1, "client_id": clientId]) && readFrame() { return true } // READY
                drop()
            }
        }
        // Discord isn't running. Look again in fifteen seconds, not on every track change.
        retryAfter = Date().addingTimeInterval(15)
        return false
    }

    private func open(_ path: String) -> Bool {
        let s = socket(AF_UNIX, SOCK_STREAM, 0)
        if s < 0 { return false }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let bytes = Array(path.utf8)
        guard bytes.count < MemoryLayout.size(ofValue: addr.sun_path) else { close(s); return false }
        withUnsafeMutableBytes(of: &addr.sun_path) { $0.copyBytes(from: bytes) }
        let result = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(s, $0, socklen_t(MemoryLayout<sockaddr_un>.size)) }
        }
        if result != 0 { close(s); return false }
        // Don't hang if Discord stops answering, and don't crash (SIGPIPE) if it goes away mid-write.
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
        var one: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_NOSIGPIPE, &one, socklen_t(MemoryLayout<Int32>.size))
        fd = s
        return true
    }

    private func writeFrame(op: Int32, _ payload: [String: Any]) -> Bool {
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return false }
        var data = Data()
        for value in [op, Int32(body.count)] {
            var le = value.littleEndian
            withUnsafeBytes(of: &le) { data.append(contentsOf: $0) }
        }
        data.append(body)
        return data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
            var sent = 0
            while sent < raw.count {
                let n = write(fd, raw.baseAddress!.advanced(by: sent), raw.count - sent)
                if n <= 0 { return false }
                sent += n
            }
            return true
        }
    }

    private func readFrame() -> Bool {
        guard let head = readExactly(8) else { return false }
        let length = Int(head[4]) | Int(head[5]) << 8 | Int(head[6]) << 16 | Int(head[7]) << 24
        guard length >= 0, length <= 1 << 20 else { return false }
        return readExactly(length) != nil
    }

    private func readExactly(_ count: Int) -> [UInt8]? {
        var buffer = [UInt8](repeating: 0, count: count)
        var got = 0
        while got < count {
            let n = buffer.withUnsafeMutableBytes { read(fd, $0.baseAddress!.advanced(by: got), count - got) }
            if n <= 0 { return nil }
            got += n
        }
        return buffer
    }

    private func drop() {
        if fd >= 0 { close(fd) }
        fd = -1
        shown = false
    }

    /// Discord wants 2 to 128 characters.
    private func fit(_ text: String, _ fallback: String) -> String {
        var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if t.count < 2 { t = fallback }
        if t.count > 128 { t = String(t.prefix(127)) + "…" }
        return t
    }
}
