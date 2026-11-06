// Tuno for macOS: a small native window (AppKit + WebKit) around your Tuno server's web app.
// It adds what a browser tab can't: its own Dock icon and menu bar, a remembered window, music that keeps playing
// when the window is closed, a friendly "can't reach your server" page that reconnects by itself, and your
// Discord status ("Listening to ..."). Build it with build.sh (on a Mac, or with the GitHub Actions workflow).
import AppKit
import WebKit

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
let defaultServer = "https://tuno.eu.cc/"
let backColor = NSColor(srgbRed: 18 / 255, green: 18 / 255, blue: 18 / 255, alpha: 1)

enum Prefs {
    static var server: String? {
        get { UserDefaults.standard.string(forKey: "server") }
        set { UserDefaults.standard.set(newValue, forKey: "server") }
    }

    /// Show what's playing on Discord. On unless switched off in Settings → This Mac.
    static var discord: Bool {
        get { UserDefaults.standard.object(forKey: "discord") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "discord") }
    }
}

/// Turns "192.168.1.5:7070" or "https://music.example.com/" into a usable http(s) address, or nil.
func normalizeServer(_ text: String) -> String? {
    var t = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.isEmpty { return nil }
    if !t.contains("://") { t = "http://" + t }
    guard let u = URL(string: t), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let host = u.host, !host.isEmpty else { return nil }
    return u.absoluteString
}

/// Asks for the server address. Returns nil when cancelled.
func askServer(current: String?) -> String? {
    let alert = NSAlert()
    alert.messageText = "Tuno server"
    alert.informativeText = "Address of your Tuno server, for example http://192.168.1.50:7070 or https://music.example.com"
    alert.addButton(withTitle: "Connect")
    alert.addButton(withTitle: "Cancel")
    let box = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
    box.stringValue = current ?? "http://"
    alert.accessoryView = box
    alert.window.initialFirstResponder = box
    while true {
        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        if let url = normalizeServer(box.stringValue) { return url }
        alert.informativeText = "That doesn't look like a web address. Try something like http://192.168.1.50:7070"
    }
}

// MARK: - the web view

final class WebController: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let web: WKWebView
    private(set) var server: String
    private let discord = DiscordPresence()
    private var offline = false
    private var retryTimer: Timer?

    init(server: String) {
        self.server = server
        let config = WKWebViewConfiguration()
        // Music has to start without a click (the next song in the queue, Autoplay).
        config.mediaTypesRequiringUserActionForPlayback = []
        // The web page reads this to know it's in the Mac app ("TunoMac/1.2.0"). Safari's token keeps sites happy.
        config.applicationNameForUserAgent = "Version/17.0 Safari/605.1.15 TunoMac/\(appVersion)"
        if #available(macOS 12.3, *) { config.preferences.isElementFullscreenEnabled = true }
        web = WKWebView(frame: .zero, configuration: config)
        super.init()
        // The page talks to the app through window.webkit.messageHandlers.tuno (see web/src/lib/windows.ts).
        config.userContentController.add(self, name: "tuno")
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.setValue(false, forKey: "drawsBackground") // no white flash while the page loads
        if #available(macOS 12.0, *) { web.underPageBackgroundColor = backColor }
    }

    func start() { navigate() }

    func navigate() {
        guard let url = URL(string: server) else { showOffline(); return }
        web.load(URLRequest(url: url))
    }

    func reload() {
        if offline { navigate() } else { web.reload() }
    }

    func openSettings() {
        guard !offline, let url = URL(string: "settings", relativeTo: URL(string: server)) else { return }
        web.load(URLRequest(url: url))
    }

    func changeServer() {
        guard let next = askServer(current: server) else { return }
        Prefs.server = next
        server = next
        navigate()
    }

    // MARK: messages from the page

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        if let text = message.body as? String {
            // From the offline page's buttons.
            if text == "change-server" { changeServer() } else if text == "retry" { navigate() }
            return
        }
        guard let msg = message.body as? [String: Any], let type = msg["type"] as? String else { return }
        switch type {
        case "now-playing":
            nowPlaying(msg)
        case "set-discord":
            Prefs.discord = msg["on"] as? Bool ?? false
            if !Prefs.discord { discord.clear() }
            postStatus()
        case "get-status":
            postStatus()
        default:
            break
        }
    }

    /// Tells the page the app's settings (Settings → This Mac reads the Discord switch from it).
    private func postStatus() {
        send(["type": "update-status", "state": "idle", "auto": false, "local": false, "discord": Prefs.discord])
    }

    private func send(_ message: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('tuno-message',{detail:\(json)}))", completionHandler: nil)
    }

    private func nowPlaying(_ msg: [String: Any]) {
        guard Prefs.discord else { discord.clear(); return }
        let playing = msg["playing"] as? Bool ?? false
        let title = msg["title"] as? String ?? ""
        let artist = msg["artist"] as? String ?? ""
        let position = (msg["position"] as? NSNumber)?.doubleValue ?? 0
        let duration = (msg["duration"] as? NSNumber)?.doubleValue ?? 0
        if playing && !title.isEmpty { discord.show(title: title, artist: artist, position: position, duration: duration) }
        else { discord.clear() }
    }

    // MARK: navigation

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if #available(macOS 11.3, *), action.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        // Links to other sites open in the browser; Tuno itself stays in the window.
        if action.navigationType == .linkActivated, let url = action.request.url, !isTuno(url) {
            openExternal(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        // Files the web view can't show (an APK, an installer) are saved to Downloads.
        if !response.canShowMIMEType {
            if #available(macOS 11.3, *) { decisionHandler(.download); return }
            if let url = response.response.url { openExternal(url) }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        if webView.url?.scheme == "http" || webView.url?.scheme == "https" { offline = false }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let e = error as NSError
        guard e.domain == NSURLErrorDomain else { return }
        switch e.code {
        case NSURLErrorCannotConnectToHost, NSURLErrorCannotFindHost, NSURLErrorTimedOut, NSURLErrorNetworkConnectionLost,
             NSURLErrorNotConnectedToInternet, NSURLErrorDNSLookupFailed, NSURLErrorSecureConnectionFailed:
            showOffline()
        default:
            break
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = Downloads.shared
    }

    @available(macOS 11.3, *)
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = Downloads.shared
    }

    // MARK: windows, panels and dialogs the page asks for

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
                 windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target="_blank": Tuno pages open here, everything else in the browser.
        if let url = action.request.url {
            if isTuno(url) { webView.load(action.request) } else { openExternal(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        if let window = webView.window {
            panel.beginSheetModal(for: window) { completionHandler($0 == .OK ? panel.urls : nil) }
        } else {
            completionHandler(panel.runModal() == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.addButton(withTitle: "OK")
        alert.addButton(withTitle: "Cancel")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }

    // MARK: offline page

    /// Shows "Can't reach your Tuno server" and keeps checking; the app opens as soon as the server answers.
    private func showOffline() {
        offline = true
        let safe = server.replacingOccurrences(of: "&", with: "&amp;").replacingOccurrences(of: "<", with: "&lt;")
        let html = """
        <!doctype html><meta charset=utf-8><title>Tuno</title><style>
        html,body{height:100%;margin:0;background:#121212;color:#fff;font:15px -apple-system,system-ui,sans-serif}
        body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;box-sizing:border-box}
        h1{font-size:26px;margin:0}p{color:#b3b3b3;margin:0;max-width:440px;line-height:1.5}code{color:#fff}
        div{display:flex;gap:10px;margin-top:10px}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 22px;cursor:pointer;background:#1ed760;color:#000}
        button.alt{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px #7c7c7c}</style>
        <h1>Can't reach your Tuno server</h1>
        <p><code>\(safe)</code></p>
        <p>Check that it's running and that this Mac is on the same network (or connected to your VPN). Tuno keeps trying and opens as soon as it answers.</p>
        <div><button onclick="webkit.messageHandlers.tuno.postMessage('retry')">Try again</button>
        <button class=alt onclick="webkit.messageHandlers.tuno.postMessage('change-server')">Change server</button></div>
        """
        web.loadHTMLString(html, baseURL: nil)
        retryTimer?.invalidate()
        retryTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.checkServer() }
    }

    private func checkServer() {
        guard offline, let url = URL(string: server) else { retryTimer?.invalidate(); return }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3)
        request.httpMethod = "HEAD"
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            guard response != nil else { return }
            DispatchQueue.main.async {
                guard let self, self.offline else { return }
                self.retryTimer?.invalidate()
                self.navigate()
            }
        }.resume()
    }

    // MARK: helpers

    private func isTuno(_ url: URL) -> Bool {
        guard let base = URL(string: server) else { return false }
        return url.scheme == base.scheme && url.host == base.host && url.port == base.port
    }

    private func openExternal(_ url: URL) {
        guard let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else { return }
        NSWorkspace.shared.open(url)
    }
}

/// Saves downloads (exported themes, app files) to the Downloads folder without asking, like Safari.
@available(macOS 11.3, *)
final class Downloads: NSObject, WKDownloadDelegate {
    static let shared = Downloads()

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let folder = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser
        let name = suggestedFilename.isEmpty ? "download" : suggestedFilename
        var target = folder.appendingPathComponent(name)
        let base = (name as NSString).deletingPathExtension
        let ext = (name as NSString).pathExtension
        var n = 2
        while FileManager.default.fileExists(atPath: target.path) {
            target = folder.appendingPathComponent(ext.isEmpty ? "\(base) \(n)" : "\(base) \(n).\(ext)")
            n += 1
        }
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        NSSound(named: "Glass")?.play()
    }
}

// MARK: - the app

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow!
    private var controller: WebController!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        var server = Prefs.server
        if server == nil {
            NSApp.activate(ignoringOtherApps: true)
            server = askServer(current: defaultServer) ?? defaultServer
            Prefs.server = server
        }
        controller = WebController(server: server!)

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Tuno"
        window.minSize = NSSize(width: 380, height: 520)
        window.backgroundColor = backColor
        window.appearance = NSAppearance(named: .darkAqua)
        window.titlebarAppearsTransparent = true
        window.tabbingMode = .disallowed
        window.collectionBehavior.insert(.fullScreenPrimary)
        window.contentView = controller.web
        window.delegate = self
        window.center()
        window.setFrameAutosaveName("TunoMain") // remembers size and position
        controller.web.addObserver(self, forKeyPath: "title", options: .new, context: nil)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        controller.start()
    }

    override func observeValue(forKeyPath keyPath: String?, of object: Any?, change: [NSKeyValueChangeKey: Any]?,
                               context: UnsafeMutableRawPointer?) {
        let title = controller.web.title ?? ""
        window.title = title.isEmpty ? "Tuno" : title
    }

    /// Closing the window hides it, so the music keeps playing (like Spotify). Quit with ⌘Q.
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag { window.makeKeyAndOrderFront(nil) }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationSupportsSecureRestorableState(_ app: NSApplication) -> Bool { true }

    // MARK: menu

    @objc func reload() { controller.reload() }
    @objc func changeServer() { controller.changeServer() }
    @objc func openSettings() { controller.openSettings() }
    @objc func showWindow() { window.makeKeyAndOrderFront(nil) }

    private func buildMenu() {
        let main = NSMenu()

        let appMenu = NSMenu(title: "Tuno")
        appMenu.addItem(withTitle: "About Tuno", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(item("Settings…", #selector(openSettings), ","))
        appMenu.addItem(item("Change Server…", #selector(changeServer), ""))
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Tuno", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = appMenu.addItem(withTitle: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(withTitle: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Tuno", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        add(appMenu, to: main)

        // Without an Edit menu, ⌘C / ⌘V / ⌘A don't work in the web page's text boxes.
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        add(edit, to: main)

        let view = NSMenu(title: "View")
        view.addItem(item("Reload", #selector(reload), "r"))
        let fullscreen = view.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullscreen.keyEquivalentModifierMask = [.command, .control]
        add(view, to: main)

        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(.separator())
        windowMenu.addItem(item("Tuno", #selector(showWindow), "0"))
        add(windowMenu, to: main)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }

    private func item(_ title: String, _ action: Selector, _ key: String) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        return i
    }

    private func add(_ menu: NSMenu, to main: NSMenu) {
        let holder = NSMenuItem(title: menu.title, action: nil, keyEquivalent: "")
        holder.submenu = menu
        main.addItem(holder)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
