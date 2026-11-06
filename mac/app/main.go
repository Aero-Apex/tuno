//go:build darwin

// Tuno for macOS: a small native window (AppKit + WebKit) around your Tuno server's web app.
// It adds what a browser tab can't: its own Dock icon and menu bar, a remembered window, music that keeps playing
// when the window is closed, a friendly "can't reach your server" page that reconnects by itself, and your
// Discord status ("Listening to ..."). It's written in Go against the Objective-C runtime (see cocoa.go), so it
// can be built on any computer: see mac/README.md.
package main

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/ebitengine/purego/objc"
)

const defaultServer = "https://tuno.eu.cc/"

// Values from the AppKit, Foundation and WebKit headers.
const (
	alertFirstButton  = 1000
	modalResponseOK   = 1
	policyCancel      = 0
	policyAllow       = 1
	policyDownload    = 2
	navigationLink    = 0
	keyCommand        = 1 << 20
	keyShift          = 1 << 17
	keyOption         = 1 << 19
	keyControl        = 1 << 18
	windowTitled      = 1 << 0
	windowClosable    = 1 << 1
	windowMiniaturize = 1 << 2
	windowResizable   = 1 << 3
	backingBuffered   = 2
	tabbingDisallowed = 2
	fullScreenPrimary = 1 << 7
	kvoNew            = 1
	activationRegular = 0
	mediaTypesNone    = 0
)

var (
	app, window, web, delegate objc.ID
	server                     string
	offline                    bool
	retryTimer                 objc.ID
	discord                    = newDiscord()
)

func init() {
	// AppKit must run on the main thread, which is the one main() starts on.
	runtime.LockOSThread()
}

func main() {
	loadFrameworks()
	registerDelegate()
	app = msg(class("NSApplication"), "sharedApplication")
	msg(app, "setActivationPolicy:", activationRegular)
	msg(app, "setDelegate:", delegate)
	msg(app, "run")
}

func appVersion() string {
	v := goString(msg(msg(class("NSBundle"), "mainBundle"), "objectForInfoDictionaryKey:", nsString("CFBundleShortVersionString")))
	if v == "" {
		return "0"
	}
	return v
}

// ---- settings (NSUserDefaults) ----

func defaults() objc.ID { return msg(class("NSUserDefaults"), "standardUserDefaults") }

func savedServer() string { return goString(msg(defaults(), "stringForKey:", nsString("server"))) }

func saveServer(s string) { msg(defaults(), "setObject:forKey:", nsString(s), nsString("server")) }

// discordOn: show what's playing on Discord. On unless switched off in Settings → This Mac.
func discordOn() bool {
	if msg(defaults(), "objectForKey:", nsString("discord")) == 0 {
		return true
	}
	return msgBool(defaults(), "boolForKey:", nsString("discord"))
}

func setDiscordOn(on bool) { msg(defaults(), "setBool:forKey:", on, nsString("discord")) }

// normalizeServer turns "192.168.1.5:7070" or "https://music.example.com/" into a usable http(s) address, or "".
func normalizeServer(text string) string {
	t := strings.TrimSpace(text)
	if t == "" {
		return ""
	}
	if !strings.Contains(t, "://") {
		t = "http://" + t
	}
	u, err := url.Parse(t)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" {
		return ""
	}
	return u.String()
}

// askServer asks for the server address. Returns "" when cancelled.
func askServer(current string) string {
	alert := newObject("NSAlert")
	msg(alert, "setMessageText:", nsString("Tuno server"))
	msg(alert, "setInformativeText:", nsString("Address of your Tuno server, for example http://192.168.1.50:7070 or https://music.example.com"))
	msg(alert, "addButtonWithTitle:", nsString("Connect"))
	msg(alert, "addButtonWithTitle:", nsString("Cancel"))
	box := msg(msg(class("NSTextField"), "alloc"), "initWithFrame:", rect(0, 0, 360, 24))
	if current == "" {
		current = "http://"
	}
	msg(box, "setStringValue:", nsString(current))
	msg(alert, "setAccessoryView:", box)
	msg(msg(alert, "window"), "setInitialFirstResponder:", box)
	for {
		if msgInt(alert, "runModal") != alertFirstButton {
			return ""
		}
		if u := normalizeServer(goString(msg(box, "stringValue"))); u != "" {
			return u
		}
		msg(alert, "setInformativeText:", nsString("That doesn't look like a web address. Try something like http://192.168.1.50:7070"))
	}
}

// ---- startup ----

func didFinishLaunching() {
	buildMenu()
	server = savedServer()
	if server == "" {
		msg(app, "activateIgnoringOtherApps:", true)
		if server = askServer(defaultServer); server == "" {
			server = defaultServer
		}
		saveServer(server)
	}
	createWebView()
	createWindow()
	navigate()
}

func backColor() objc.ID {
	return msg(class("NSColor"), "colorWithSRGBRed:green:blue:alpha:", 18.0/255, 18.0/255, 18.0/255, 1.0)
}

func createWebView() {
	config := newObject("WKWebViewConfiguration")
	// Music has to start without a click (the next song in the queue, Autoplay).
	msg(config, "setMediaTypesRequiringUserActionForPlayback:", uint(mediaTypesNone))
	// The web page reads this to know it's in the Mac app ("TunoMac/1.2.0"). Safari's token keeps sites happy.
	msg(config, "setApplicationNameForUserAgent:", nsString("Version/17.0 Safari/605.1.15 TunoMac/"+appVersion()))
	if prefs := msg(config, "preferences"); responds(prefs, "setElementFullscreenEnabled:") {
		msg(prefs, "setElementFullscreenEnabled:", true)
	}
	// The page talks to the app through window.webkit.messageHandlers.tuno (see web/src/lib/windows.ts).
	msg(msg(config, "userContentController"), "addScriptMessageHandler:name:", delegate, nsString("tuno"))

	web = msg(msg(class("WKWebView"), "alloc"), "initWithFrame:configuration:", rect(0, 0, 1280, 820), config)
	msg(web, "setNavigationDelegate:", delegate)
	msg(web, "setUIDelegate:", delegate)
	msg(web, "setAllowsBackForwardNavigationGestures:", false)
	msg(web, "setValue:forKey:", msg(class("NSNumber"), "numberWithBool:", false), nsString("drawsBackground")) // no white flash
	if responds(web, "setUnderPageBackgroundColor:") {
		msg(web, "setUnderPageBackgroundColor:", backColor())
	}
	msg(web, "addObserver:forKeyPath:options:context:", delegate, nsString("title"), uint(kvoNew), uintptr(0))
}

func createWindow() {
	window = msg(msg(class("NSWindow"), "alloc"), "initWithContentRect:styleMask:backing:defer:",
		rect(0, 0, 1280, 820), uint(windowTitled|windowClosable|windowMiniaturize|windowResizable), uint(backingBuffered), false)
	msg(window, "setReleasedWhenClosed:", false)
	msg(window, "setTitle:", nsString("Tuno"))
	msg(window, "setMinSize:", nsSize{Width: 380, Height: 520})
	msg(window, "setBackgroundColor:", backColor())
	msg(window, "setAppearance:", msg(class("NSAppearance"), "appearanceNamed:", nsString("NSAppearanceNameDarkAqua")))
	msg(window, "setTitlebarAppearsTransparent:", true)
	msg(window, "setTabbingMode:", tabbingDisallowed)
	msg(window, "setCollectionBehavior:", uint(msgInt(window, "collectionBehavior")|fullScreenPrimary))
	msg(window, "setContentView:", web)
	msg(window, "setDelegate:", delegate)
	msg(window, "center")
	msg(window, "setFrameAutosaveName:", nsString("TunoMain")) // remembers size and position
	msg(window, "makeKeyAndOrderFront:", objc.ID(0))
	msg(app, "activateIgnoringOtherApps:", true)
}

// ---- navigation ----

func navigate() {
	u := nsURL(server)
	if u == 0 {
		showOffline()
		return
	}
	msg(web, "loadRequest:", msg(class("NSURLRequest"), "requestWithURL:", u))
}

func reload() {
	if offline {
		navigate()
	} else {
		msg(web, "reload")
	}
}

func openSettings() {
	base, err := url.Parse(server)
	if offline || err != nil {
		return
	}
	if u := nsURL(base.ResolveReference(&url.URL{Path: "settings"}).String()); u != 0 {
		msg(web, "loadRequest:", msg(class("NSURLRequest"), "requestWithURL:", u))
	}
}

func changeServer() {
	next := askServer(server)
	if next == "" {
		return
	}
	saveServer(next)
	server = next
	navigate()
}

func isTuno(address string) bool {
	a, err1 := url.Parse(address)
	b, err2 := url.Parse(server)
	return err1 == nil && err2 == nil && a.Scheme == b.Scheme && a.Hostname() == b.Hostname() && a.Port() == b.Port()
}

func openExternal(address string) {
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "mailto") {
		return
	}
	if nsurl := nsURL(address); nsurl != 0 {
		msg(msg(class("NSWorkspace"), "sharedWorkspace"), "openURL:", nsurl)
	}
}

func downloadsSupported() bool { return objc.GetClass("WKDownload") != 0 } // macOS 11.3 and newer

// ---- messages from the page ----

type pageMessage struct {
	Type     string  `json:"type"`
	On       bool    `json:"on"`
	Playing  bool    `json:"playing"`
	Title    string  `json:"title"`
	Artist   string  `json:"artist"`
	Position float64 `json:"position"`
	Duration float64 `json:"duration"`
}

func onPageMessage(body objc.ID) {
	if isKind(body, "NSString") {
		// From the offline page's buttons.
		switch goString(body) {
		case "change-server":
			changeServer()
		case "retry":
			navigate()
		}
		return
	}
	if !isKind(body, "NSDictionary") {
		return
	}
	data := msg(class("NSJSONSerialization"), "dataWithJSONObject:options:error:", body, uint(0), uintptr(0))
	if data == 0 {
		return
	}
	var m pageMessage
	if json.Unmarshal(dataBytes(data), &m) != nil {
		return
	}
	switch m.Type {
	case "now-playing":
		if !discordOn() {
			discord.Clear()
		} else if m.Playing && m.Title != "" {
			discord.Show(m.Title, m.Artist, m.Position, m.Duration)
		} else {
			discord.Clear()
		}
	case "set-discord":
		setDiscordOn(m.On)
		if !m.On {
			discord.Clear()
		}
		postStatus()
	case "get-status":
		postStatus()
	}
}

// postStatus tells the page the app's settings (Settings → This Mac reads the Discord switch from it).
func postStatus() {
	b, _ := json.Marshal(map[string]any{"type": "update-status", "state": "idle", "auto": false, "local": false, "discord": discordOn()})
	js := fmt.Sprintf("window.dispatchEvent(new CustomEvent('tuno-message',{detail:%s}))", b)
	msg(web, "evaluateJavaScript:completionHandler:", nsString(js), objc.ID(0))
}

// ---- offline page ----

// showOffline shows "Can't reach your Tuno server" and keeps checking; the app opens as soon as the server answers.
func showOffline() {
	offline = true
	page := `<!doctype html><meta charset=utf-8><title>Tuno</title><style>
html,body{height:100%;margin:0;background:#121212;color:#fff;font:15px -apple-system,system-ui,sans-serif}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;text-align:center;padding:24px;box-sizing:border-box}
h1{font-size:26px;margin:0}p{color:#b3b3b3;margin:0;max-width:440px;line-height:1.5}code{color:#fff}
div{display:flex;gap:10px;margin-top:10px}button{font:inherit;font-weight:700;border:0;border-radius:999px;padding:10px 22px;cursor:pointer;background:#1ed760;color:#000}
button.alt{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px #7c7c7c}</style>
<h1>Can't reach your Tuno server</h1>
<p><code>` + html.EscapeString(server) + `</code></p>
<p>Check that it's running and that this Mac is on the same network (or connected to your VPN). Tuno keeps trying and opens as soon as it answers.</p>
<div><button onclick="webkit.messageHandlers.tuno.postMessage('retry')">Try again</button>
<button class=alt onclick="webkit.messageHandlers.tuno.postMessage('change-server')">Change server</button></div>`
	msg(web, "loadHTMLString:baseURL:", nsString(page), objc.ID(0))
	if retryTimer != 0 {
		msg(retryTimer, "invalidate")
	}
	retryTimer = msg(class("NSTimer"), "scheduledTimerWithTimeInterval:target:selector:userInfo:repeats:",
		4.0, delegate, sel("tunoCheckServer:"), objc.ID(0), true)
}

// checkServer runs every few seconds while offline. The request runs off the main thread.
func checkServer() {
	if !offline {
		stopRetrying()
		return
	}
	address := server
	go func() {
		client := http.Client{Timeout: 3 * time.Second}
		resp, err := client.Head(address)
		if err != nil {
			return
		}
		resp.Body.Close()
		msg(delegate, "performSelectorOnMainThread:withObject:waitUntilDone:", sel("tunoServerAnswered:"), objc.ID(0), false)
	}()
}

func serverAnswered() {
	if offline {
		stopRetrying()
		navigate()
	}
}

func stopRetrying() {
	if retryTimer != 0 {
		msg(retryTimer, "invalidate")
		retryTimer = 0
	}
}

// ---- downloads ----

// downloadTarget picks ~/Downloads/<name>, adding " 2", " 3"… if a file is already there, like Safari.
func downloadTarget(name string) string {
	home, _ := os.UserHomeDir()
	folder := filepath.Join(home, "Downloads")
	if name == "" {
		name = "download"
	}
	name = filepath.Base(name)
	target := filepath.Join(folder, name)
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for n := 2; ; n++ {
		if _, err := os.Stat(target); err != nil {
			return target
		}
		target = filepath.Join(folder, fmt.Sprintf("%s %d%s", base, n, ext))
	}
}

// ---- menu ----

func buildMenu() {
	bar := newObject("NSMenu")

	appMenu := submenu(bar, "Tuno")
	add(appMenu, "About Tuno", "orderFrontStandardAboutPanel:", "", 0, false)
	separator(appMenu)
	add(appMenu, "Settings…", "tunoSettings:", ",", 0, true)
	add(appMenu, "Change Server…", "tunoChangeServer:", "", 0, true)
	separator(appMenu)
	add(appMenu, "Hide Tuno", "hide:", "h", 0, false)
	add(appMenu, "Hide Others", "hideOtherApplications:", "h", keyCommand|keyOption, false)
	add(appMenu, "Show All", "unhideAllApplications:", "", 0, false)
	separator(appMenu)
	add(appMenu, "Quit Tuno", "terminate:", "q", 0, false)

	// Without an Edit menu, ⌘C / ⌘V / ⌘A don't work in the web page's text boxes.
	edit := submenu(bar, "Edit")
	add(edit, "Undo", "undo:", "z", 0, false)
	add(edit, "Redo", "redo:", "z", keyCommand|keyShift, false)
	separator(edit)
	add(edit, "Cut", "cut:", "x", 0, false)
	add(edit, "Copy", "copy:", "c", 0, false)
	add(edit, "Paste", "paste:", "v", 0, false)
	add(edit, "Select All", "selectAll:", "a", 0, false)

	view := submenu(bar, "View")
	add(view, "Reload", "tunoReload:", "r", 0, true)
	add(view, "Enter Full Screen", "toggleFullScreen:", "f", keyCommand|keyControl, false)

	win := submenu(bar, "Window")
	add(win, "Minimize", "performMiniaturize:", "m", 0, false)
	add(win, "Zoom", "performZoom:", "", 0, false)
	separator(win)
	add(win, "Tuno", "tunoShowWindow:", "0", 0, true)
	msg(app, "setWindowsMenu:", win)

	msg(app, "setMainMenu:", bar)
}

func submenu(main objc.ID, title string) objc.ID {
	menu := msg(msg(class("NSMenu"), "alloc"), "initWithTitle:", nsString(title))
	holder := msg(msg(class("NSMenuItem"), "alloc"), "initWithTitle:action:keyEquivalent:", nsString(title), objc.SEL(0), nsString(""))
	msg(holder, "setSubmenu:", menu)
	msg(main, "addItem:", holder)
	return menu
}

// add adds a menu item. Items of our own (mine) go to the app delegate; standard ones go to whatever is focused.
func add(menu objc.ID, title, action, key string, modifiers uint, mine bool) {
	item := msg(msg(class("NSMenuItem"), "alloc"), "initWithTitle:action:keyEquivalent:", nsString(title), sel(action), nsString(key))
	if modifiers != 0 {
		msg(item, "setKeyEquivalentModifierMask:", modifiers)
	}
	if mine {
		msg(item, "setTarget:", delegate)
	}
	msg(menu, "addItem:", item)
}

func separator(menu objc.ID) { msg(menu, "addItem:", msg(class("NSMenuItem"), "separatorItem")) }

// ---- the delegate: one object answers for the app, the window, the web view and downloads ----

func registerDelegate() {
	type id = objc.ID
	type selector = objc.SEL
	type block = objc.Block
	methods := []objc.MethodDef{
		// NSApplicationDelegate
		{Cmd: sel("applicationDidFinishLaunching:"), Fn: func(self id, _ selector, _ id) { didFinishLaunching() }},
		{Cmd: sel("applicationShouldHandleReopen:hasVisibleWindows:"), Fn: func(self id, _ selector, _ id, visible bool) bool {
			if !visible {
				msg(window, "makeKeyAndOrderFront:", objc.ID(0))
			}
			return true
		}},
		{Cmd: sel("applicationShouldTerminateAfterLastWindowClosed:"), Fn: func(self id, _ selector, _ id) bool { return false }},
		{Cmd: sel("applicationSupportsSecureRestorableState:"), Fn: func(self id, _ selector, _ id) bool { return true }},

		// NSWindowDelegate: closing the window hides it, so the music keeps playing (like Spotify). Quit with ⌘Q.
		{Cmd: sel("windowShouldClose:"), Fn: func(self id, _ selector, w id) bool {
			msg(w, "orderOut:", objc.ID(0))
			return false
		}},

		// The page title becomes the window title.
		{Cmd: sel("observeValueForKeyPath:ofObject:change:context:"), Fn: func(self id, _ selector, _ id, _ id, _ id, _ uintptr) {
			title := goString(msg(web, "title"))
			if title == "" {
				title = "Tuno"
			}
			msg(window, "setTitle:", nsString(title))
		}},

		// Menu items, the offline timer, and the answer from the background server check.
		{Cmd: sel("tunoReload:"), Fn: func(self id, _ selector, _ id) { reload() }},
		{Cmd: sel("tunoChangeServer:"), Fn: func(self id, _ selector, _ id) { changeServer() }},
		{Cmd: sel("tunoSettings:"), Fn: func(self id, _ selector, _ id) { openSettings() }},
		{Cmd: sel("tunoShowWindow:"), Fn: func(self id, _ selector, _ id) { msg(window, "makeKeyAndOrderFront:", objc.ID(0)) }},
		{Cmd: sel("tunoCheckServer:"), Fn: func(self id, _ selector, _ id) { checkServer() }},
		{Cmd: sel("tunoServerAnswered:"), Fn: func(self id, _ selector, _ id) { serverAnswered() }},

		// WKScriptMessageHandler
		{Cmd: sel("userContentController:didReceiveScriptMessage:"), Fn: func(self id, _ selector, _ id, message id) {
			onPageMessage(msg(message, "body"))
		}},

		// WKNavigationDelegate
		{Cmd: sel("webView:decidePolicyForNavigationAction:decisionHandler:"), Fn: func(self id, _ selector, _ id, action id, handler block) {
			if responds(action, "shouldPerformDownload") && msgBool(action, "shouldPerformDownload") {
				callBlock(handler, policyDownload)
				return
			}
			// Links to other sites open in the browser; Tuno itself stays in the window.
			if msgInt(action, "navigationType") == navigationLink {
				if u := urlString(msg(msg(action, "request"), "URL")); u != "" && !isTuno(u) {
					openExternal(u)
					callBlock(handler, policyCancel)
					return
				}
			}
			callBlock(handler, policyAllow)
		}},
		{Cmd: sel("webView:decidePolicyForNavigationResponse:decisionHandler:"), Fn: func(self id, _ selector, _ id, response id, handler block) {
			// Files the web view can't show (an APK, an installer) are saved to Downloads.
			if !msgBool(response, "canShowMIMEType") {
				if downloadsSupported() {
					callBlock(handler, policyDownload)
					return
				}
				openExternal(urlString(msg(msg(response, "response"), "URL")))
				callBlock(handler, policyCancel)
				return
			}
			callBlock(handler, policyAllow)
		}},
		{Cmd: sel("webView:didFinishNavigation:"), Fn: func(self id, _ selector, wv id, _ id) {
			if u := urlString(msg(wv, "URL")); strings.HasPrefix(u, "http:") || strings.HasPrefix(u, "https:") {
				offline = false
			}
		}},
		{Cmd: sel("webView:didFailProvisionalNavigation:withError:"), Fn: func(self id, _ selector, _ id, _ id, err id) {
			if goString(msg(err, "domain")) != "NSURLErrorDomain" {
				return
			}
			switch msgInt(err, "code") {
			case -1004, -1003, -1001, -1005, -1009, -1006, -1200: // can't connect, host not found, timed out, connection lost, offline, DNS, TLS
				showOffline()
			}
		}},
		{Cmd: sel("webViewWebContentProcessDidTerminate:"), Fn: func(self id, _ selector, wv id) { msg(wv, "reload") }},
		{Cmd: sel("webView:navigationAction:didBecomeDownload:"), Fn: func(self id, _ selector, _ id, _ id, download id) {
			msg(download, "setDelegate:", delegate)
		}},
		{Cmd: sel("webView:navigationResponse:didBecomeDownload:"), Fn: func(self id, _ selector, _ id, _ id, download id) {
			msg(download, "setDelegate:", delegate)
		}},

		// WKDownloadDelegate: save to Downloads without asking, like Safari.
		{Cmd: sel("download:decideDestinationUsingResponse:suggestedFilename:completionHandler:"), Fn: func(self id, _ selector, _ id, _ id, name id, handler block) {
			target := msg(class("NSURL"), "fileURLWithPath:", nsString(downloadTarget(goString(name))))
			callBlock(handler, uintptr(target))
		}},
		{Cmd: sel("downloadDidFinish:"), Fn: func(self id, _ selector, _ id) {
			if sound := msg(class("NSSound"), "soundNamed:", nsString("Glass")); sound != 0 {
				msg(sound, "play")
			}
		}},

		// WKUIDelegate
		{Cmd: sel("webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:"), Fn: func(self id, _ selector, wv id, _ id, action id, _ id) id {
			// target="_blank": Tuno pages open here, everything else in the browser.
			request := msg(action, "request")
			if u := urlString(msg(request, "URL")); u != "" {
				if isTuno(u) {
					msg(wv, "loadRequest:", request)
				} else {
					openExternal(u)
				}
			}
			return 0
		}},
		{Cmd: sel("webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:"), Fn: func(self id, _ selector, _ id, params id, _ id, handler block) {
			panel := msg(class("NSOpenPanel"), "openPanel")
			msg(panel, "setAllowsMultipleSelection:", msgBool(params, "allowsMultipleSelection"))
			msg(panel, "setCanChooseDirectories:", false)
			msg(panel, "setCanChooseFiles:", true)
			if msgInt(panel, "runModal") == modalResponseOK {
				callBlock(handler, uintptr(msg(panel, "URLs")))
			} else {
				callBlock(handler, 0)
			}
		}},
		{Cmd: sel("webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:"), Fn: func(self id, _ selector, _ id, text id, _ id, handler block) {
			alert := newObject("NSAlert")
			msg(alert, "setMessageText:", text)
			msgInt(alert, "runModal")
			callBlock(handler)
		}},
		{Cmd: sel("webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:"), Fn: func(self id, _ selector, _ id, text id, _ id, handler block) {
			alert := newObject("NSAlert")
			msg(alert, "setMessageText:", text)
			msg(alert, "addButtonWithTitle:", nsString("OK"))
			msg(alert, "addButtonWithTitle:", nsString("Cancel"))
			callBlock(handler, boolArg(msgInt(alert, "runModal") == alertFirstButton))
		}},
	}
	cls, err := objc.RegisterClass("TunoDelegate", objc.GetClass("NSObject"),
		protocols("NSApplicationDelegate", "NSWindowDelegate", "WKNavigationDelegate", "WKUIDelegate", "WKScriptMessageHandler", "WKDownloadDelegate"),
		nil, methods)
	if err != nil {
		panic(err)
	}
	delegate = msg(msg(objc.ID(cls), "alloc"), "init")
}
