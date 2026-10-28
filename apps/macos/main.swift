import Cocoa
import WebKit
import Network
import UniformTypeIdentifiers

// Serves bundled assets only; never exposes the user's books or credentials.
final class AssetServer {
    private var listener: NWListener?
    private let root: URL
    private let queue = DispatchQueue(label: "com.leafreader.assets")
    let port: UInt16 = 17643
    init(root: URL) { self.root = root.standardizedFileURL }
    func start(_ completion: @escaping (Error?) -> Void) {
        do {
            let parameters = NWParameters.tcp
            parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!)
            let server = try NWListener(using: parameters)
            var reported = false
            server.stateUpdateHandler = { state in
                switch state {
                case .ready: if !reported { reported = true; DispatchQueue.main.async { completion(nil) } }
                case .failed(let error): if !reported { reported = true; DispatchQueue.main.async { completion(error) } }
                default: break
                }
            }
            server.newConnectionHandler = { [weak self] connection in
                guard let self = self else { connection.cancel(); return }
                connection.start(queue: self.queue)
                self.receive(connection, accumulated: Data())
            }
            self.listener = server; server.start(queue: queue)
        } catch { completion(error) }
    }
    private func receive(_ connection: NWConnection, accumulated: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] data, _, complete, error in
            guard let self = self else { connection.cancel(); return }
            var request = accumulated; if let data = data { request.append(data) }
            guard request.count <= 32768, error == nil else { connection.cancel(); return }
            if let text = String(data: request, encoding: .utf8), text.contains("\r\n\r\n") { self.respond(connection, request: text) }
            else if !complete { self.receive(connection, accumulated: request) }
            else { connection.cancel() }
        }
    }
    private func respond(_ connection: NWConnection, request: String) {
        let parts = request.components(separatedBy: "\r\n")[0].split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET" || parts[0] == "HEAD" else { connection.cancel(); return }
        let path = String(parts[1]).components(separatedBy: "?")[0].removingPercentEncoding ?? ""
        let target = root.appendingPathComponent(path == "/" ? "index.html" : String(path.dropFirst())).standardizedFileURL.resolvingSymlinksInPath()
        let allowed = target.path.hasPrefix(root.resolvingSymlinksInPath().path + "/")
        let content = allowed ? try? Data(contentsOf: target) : nil
        let mime: String
        switch target.pathExtension { case "html": mime = "text/html; charset=utf-8"; case "js", "mjs": mime = "text/javascript; charset=utf-8"; case "css": mime = "text/css; charset=utf-8"; case "json": mime = "application/json"; case "wasm": mime = "application/wasm"; case "svg": mime = "image/svg+xml"; case "png": mime = "image/png"; default: mime = "application/octet-stream" }
        let body = content ?? Data("Not found".utf8)
        let status = content == nil ? "404 Not Found" : "200 OK"
        let headers = "HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n"
        var response = Data(headers.utf8); if parts[0] != "HEAD" { response.append(body) }
        connection.send(content: response, completion: .contentProcessed { _ in connection.cancel() })
    }
}

enum NativeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: ReaderWebView!
    private var server: AssetServer!
    private var chrome: NativeChrome!
    private let tokenVault = TokenVault()
    func applicationDidFinishLaunching(_ notification: Notification) {
        if let icon = Bundle.main.url(forResource: "LeafReader", withExtension: "icns") { NSApp.applicationIconImage = NSImage(contentsOf: icon) }
        let menu = NSMenu(); let appItem = NSMenuItem(); let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于页间", action: #selector(showAbout), keyEquivalent: "")
        appMenu.addItem(.separator()); appMenu.addItem(withTitle: "退出页间", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); appItem.submenu = appMenu; menu.addItem(appItem)
        let editItem = NSMenuItem(); let edit = NSMenu(title: "编辑")
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] { edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key) }
        editItem.submenu = edit; menu.addItem(editItem); NSApp.mainMenu = menu
        let config = WKWebViewConfiguration(); config.userContentController.addUserScript(WKUserScript(source: "window.__leafNativeChrome = true; window.__leafTrackpadPhases = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)); config.websiteDataStore = .default(); config.userContentController.add(self, name: "leaf")
        webView = ReaderWebView(frame: .zero, configuration: config); webView.uiDelegate = self; webView.navigationDelegate = self
        webView.onTrackpadPhase = { [weak self] phase in
            self?.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('leaf-trackpad-phase', {detail: '\(phase)'}))", completionHandler: nil)
        }
        webView.underPageBackgroundColor = NSColor(red: 0.97, green: 0.965, blue: 0.95, alpha: 1)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 830), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "页间 · Leaf Reader"; window.minSize = NSSize(width: 740, height: 560); window.contentView = NSView(frame: window.contentLayoutRect)
        let surface = window.contentView!; webView.frame = surface.bounds; webView.autoresizingMask = [.width, .height]; surface.addSubview(webView)
        chrome = NativeChrome(frame: surface.bounds); chrome.autoresizingMask = [.width, .height]
        chrome.onAction = { [weak self] action, value in
            var detail: [String: Any] = ["action": action]; if let value = value { detail["value"] = value }
            guard let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
            self?.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('leaf-native-action', {detail: \(json)}))", completionHandler: nil)
        }
        surface.addSubview(chrome)
        window.center(); window.setFrameAutosaveName("LeafReaderWindow"); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
        guard let root = Bundle.main.resourceURL?.appendingPathComponent("web") else { fail("未找到阅读资源，请重新构建应用。"); return }
        server = AssetServer(root: root)
        server.start { [weak self] error in
            guard let self = self else { return }
            if let error = error { self.fail("无法启动本地阅读服务（端口 17643）。请关闭其他页间实例后重试。\n\(error.localizedDescription)") }
            else { self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:17643/")!)) }
        }
    }
    @objc private func showAbout() { NSApp.orderFrontStandardAboutPanel(options: [.applicationName: "页间 · Leaf Reader", .applicationVersion: "0.1.12", .credits: NSAttributedString(string: "在书页间，慢下来。\n本地阅读 · 按需同步")]) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    private func fail(_ message: String) { let alert = NSAlert(); alert.messageText = "页间暂时无法打开"; alert.informativeText = message; alert.runModal() }
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.plainText, .pdf]; panel.allowsMultipleSelection = true; panel.canChooseDirectories = false
        panel.beginSheetModal(for: window) { response in completionHandler(response == .OK ? panel.urls : nil) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "http", url.host == "127.0.0.1", url.port == 17643 { decisionHandler(.allow) } else { decisionHandler(.cancel) }
    }
    private func reply(_ id: String, result: Any? = nil, error: String? = nil) {
        var response: [String: Any] = ["id": id]; if let result = result { response["result"] = result }; if let error = error { response["error"] = error }
        guard let data = try? JSONSerialization.data(withJSONObject: response, options: [.fragmentsAllowed]), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { self.webView.evaluateJavaScript("window.__leafReply(\(json))", completionHandler: nil) }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "http", message.frameInfo.request.url?.host == "127.0.0.1", message.frameInfo.request.url?.port == 17643,
              let string = message.body as? String, let data = string.data(using: .utf8), let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = request["id"] as? String, let method = request["method"] as? String else { return }
        let args = request["args"] as? [String: Any] ?? [:]
        do {
            switch method {
            case "updateChrome":
                guard let state = args["state"] as? [String: Any] else { throw NativeError.message("界面状态无效") }
                let reader = state["reader"] as? [String: Any]
                webView.readerGesturesEnabled = state["mode"] as? String == "reader" && state["blocked"] as? Bool != true && reader?["gestureEnabled"] as? Bool == true
                chrome.update(state); reply(id, result: true)
            case "showPreferences": chrome.showPreferences(); reply(id, result: true)
            case "getSecret": reply(id, result: try tokenVault.read())
            case "setSecret": try tokenVault.save(args["token"] as? String ?? ""); reply(id, result: true)
            case "importConnection":
                let panel = NSOpenPanel(); panel.allowedContentTypes = [.json]; panel.allowsMultipleSelection = false
                panel.beginSheetModal(for: window) { response in
                    guard response == .OK, let url = panel.url else { self.reply(id, error: "已取消导入"); return }
                    do {
                        let data = try Data(contentsOf: url)
                        guard data.count < 16384, let config = try JSONSerialization.jsonObject(with: data) as? [String: String],
                              let token = config["token"], let endpoint = config["endpoint"], token.count >= 32,
                              let address = URL(string: endpoint), address.scheme == "https" || address.host == "127.0.0.1"
                        else { throw NativeError.message("同步配置文件无效") }
                        self.reply(id, result: ["endpoint": endpoint, "token": token])
                    } catch { self.reply(id, error: error.localizedDescription) }
                }
            case "blobTransfer": try blobTransfer(args) { result, error in self.reply(id, result: result, error: error) }
            case "cloudRequest": try cloudRequest(id: id, args: args)
            default: reply(id, error: "未知的系统请求")
            }
        } catch { reply(id, error: error.localizedDescription) }
    }
    private func cloudRequest(id: String, args: [String: Any]) throws {
        guard let endpoint = args["endpoint"] as? String, let base = URL(string: endpoint),
              base.user == nil, base.password == nil, base.query == nil, base.fragment == nil,
              (base.scheme == "https" || (base.scheme == "http" && base.host == "127.0.0.1" && base.port == 7071)),
              let path = args["path"] as? String, path.hasPrefix("/v1/"), !path.contains(".."),
              let method = args["method"] as? String, ["GET", "PUT", "DELETE"].contains(method),
              let url = URL(string: endpoint.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + path)
        else { throw NativeError.message("同步地址或请求无效") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 20
        request.setValue("Bearer \(args["token"] as? String ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let body = args["body"], !(body is NSNull) { request.httpBody = try JSONSerialization.data(withJSONObject: body) }
        // Never follow a redirect with the user's personal synchronization credential.
        let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
        session.dataTask(with: request) { [weak self] data, response, error in
            defer { session.finishTasksAndInvalidate() }
            if let error = error { self?.reply(id, error: "网络请求失败：\(error.localizedDescription)"); return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } ?? ["error": "服务器返回了无法识别的数据"]
            self?.reply(id, result: ["status": status, "data": json])
        }.resume()
    }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
