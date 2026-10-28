import Cocoa

final class FlippedSurface: NSView {
    override var isFlipped: Bool { true }
}

final class GlassPane: NSView {
    let content = FlippedSurface()
    private var desiredVisible = false
    override var isFlipped: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        let material: NSView
        if #available(macOS 26.0, *) {
            let glass = NSGlassEffectView()
            glass.style = .regular
            glass.cornerRadius = 24
            glass.contentView = content
            if #available(macOS 27.0, *) { glass.effectIsInteractive = true }
            material = glass
        } else {
            let blur = NSVisualEffectView()
            blur.material = .sidebar; blur.blendingMode = .withinWindow; blur.state = .active
            blur.wantsLayer = true; blur.layer?.cornerRadius = 24; blur.layer?.masksToBounds = true
            blur.addSubview(content); material = blur
        }
        material.frame = bounds; material.autoresizingMask = [.width, .height]
        content.frame = bounds; content.autoresizingMask = [.width, .height]
        addSubview(material); isHidden = true; alphaValue = 0
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    func show(_ visible: Bool) {
        guard desiredVisible != visible else { return }
        desiredVisible = visible
        if visible { isHidden = false }
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            alphaValue = visible ? 1 : 0; isHidden = !visible; return
        }
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.22; context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            animator().alphaValue = visible ? 1 : 0
        }, completionHandler: { [weak self] in
            guard let self = self, !self.desiredVisible else { return }; self.isHidden = true
        })
    }
    override func hitTest(_ point: NSPoint) -> NSView? { desiredVisible ? super.hitTest(point) : nil }
}

final class TrackingSlider: NSSlider {
    var tracking: ((Bool) -> Void)?
    override func mouseDown(with event: NSEvent) {
        tracking?(true); defer { tracking?(false) }; super.mouseDown(with: event)
    }
}
final class TrackingPopUpButton: NSPopUpButton {
    var tracking: ((Bool) -> Void)?
    override func mouseDown(with event: NSEvent) {
        tracking?(true); defer { tracking?(false) }; super.mouseDown(with: event)
    }
}

final class NativeChrome: NSView, NSPopoverDelegate {
    var onAction: ((String, Any?) -> Void)?
    private let sidebar = GlassPane(); private let libraryBar = GlassPane()
    private let readerBar = GlassPane(); private let progressBar = GlassPane()
    private var state: [String: Any] = [:]
    private var controls: [String: NSButton] = [:]
    private let brandImage = NSImageView()
    private let brand = NSTextField(labelWithString: "页间")
    private let caption = NSTextField(labelWithString: "我的空间")
    private let note = NSTextField(wrappingLabelWithString: "把时间，\n留给一页好书。")
    private let libraryTitle = NSTextField(labelWithString: "我的书架")
    private let search = NSSearchField()
    private let titleLabel = NSTextField(labelWithString: "")
    private let chapterLabel = NSTextField(labelWithString: "")
    private let percent = NSTextField(labelWithString: "0%")
    private let slider = TrackingSlider(value: 0, minValue: 0, maxValue: 1000, target: nil, action: nil)
    private let format = TrackingPopUpButton(frame: .zero, pullsDown: false)
    private var popover: NSPopover?
    override var isFlipped: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame)
        for pane in [sidebar, libraryBar, readerBar, progressBar] { addSubview(pane) }
        if let image = Bundle.main.url(forResource: "LeafLogo", withExtension: "png") { brandImage.image = NSImage(contentsOf: image) }
        brandImage.imageScaling = .scaleProportionallyUpOrDown; brandImage.wantsLayer = true
        brandImage.layer?.cornerRadius = 12; brandImage.layer?.masksToBounds = true
        brandImage.setAccessibilityLabel("页间标志"); sidebar.content.addSubview(brandImage)
        brand.font = .systemFont(ofSize: 25, weight: .medium); brand.textColor = .labelColor
        caption.font = .systemFont(ofSize: 10, weight: .semibold); caption.textColor = .secondaryLabelColor
        note.font = .systemFont(ofSize: 19, weight: .light); note.textColor = .secondaryLabelColor
        sidebar.content.addSubview(brand); sidebar.content.addSubview(caption); sidebar.content.addSubview(note)
        _ = button("library", "我的书架", "books.vertical", sidebar.content)
        _ = button("bookmarks", "我的书签", "bookmark", sidebar.content)
        _ = button("settings", "阅读偏好", "textformat.size", sidebar.content)
        _ = button("connection", "阅读空间", "person.crop.circle", sidebar.content)
        libraryTitle.font = .systemFont(ofSize: 14, weight: .semibold); libraryBar.content.addSubview(libraryTitle)
        search.placeholderString = "寻找一本书…"; search.sendsSearchStringImmediately = true
        search.target = self; search.action = #selector(searchChanged); search.setAccessibilityLabel("搜索书架")
        libraryBar.content.addSubview(search)
        _ = button("import", "", "plus", libraryBar.content, label: "导入书籍")
        _ = button("sync", "", "arrow.triangle.2.circlepath", libraryBar.content, label: "同步书库")
        _ = button("close", "", "chevron.left", readerBar.content, label: "返回书架")
        _ = button("contents", "", "list.bullet", readerBar.content, label: "目录与书签")
        _ = button("find", "", "magnifyingglass", readerBar.content, label: "搜索正文")
        _ = button("bookmark", "", "bookmark", readerBar.content, label: "添加书签")
        _ = button("readerSettings", "", "textformat.size", readerBar.content, label: "阅读设置")
        titleLabel.font = .systemFont(ofSize: 13, weight: .medium); titleLabel.lineBreakMode = .byTruncatingTail
        chapterLabel.font = .systemFont(ofSize: 10); chapterLabel.textColor = .secondaryLabelColor; chapterLabel.lineBreakMode = .byTruncatingTail
        readerBar.content.addSubview(titleLabel); readerBar.content.addSubview(chapterLabel)
        _ = button("previous", "", "chevron.left", progressBar.content, label: "上一页")
        _ = button("next", "", "chevron.right", progressBar.content, label: "下一页")
        percent.font = .monospacedDigitSystemFont(ofSize: 11, weight: .regular); percent.textColor = .secondaryLabelColor
        slider.tracking = { [weak self] active in self?.onAction?("controlsInteracting", active) }
        format.tracking = { [weak self] active in self?.onAction?("controlsInteracting", active) }
        slider.target = self; slider.action = #selector(seek); slider.isContinuous = false; slider.setAccessibilityLabel("阅读进度")
        format.target = self; format.action = #selector(formatChanged); format.font = .systemFont(ofSize: 11)
        progressBar.content.addSubview(slider); progressBar.content.addSubview(percent); progressBar.content.addSubview(format)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    private func button(_ id: String, _ title: String, _ symbol: String, _ parent: NSView, label: String? = nil) -> NSButton {
        let button = NSButton(title: title, target: self, action: #selector(pressed(_:)))
        button.identifier = NSUserInterfaceItemIdentifier(id); button.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        button.imagePosition = title.isEmpty ? .imageOnly : .imageLeading
        button.bezelStyle = title.isEmpty ? .accessoryBarAction : .recessed
        button.isBordered = title.isEmpty; button.font = .systemFont(ofSize: 13, weight: .medium)
        if !title.isEmpty { button.alignment = .left }
        button.setAccessibilityLabel(label ?? title); button.toolTip = label ?? title
        parent.addSubview(button); controls[id] = button; return button
    }
    func update(_ value: [String: Any]) {
        state = value
        appearance = NSAppearance(named: value["theme"] as? String == "night" ? .darkAqua : .aqua)
        let reading = value["mode"] as? String == "reader"
        let blocked = value["blocked"] as? Bool == true
        sidebar.show(!reading && !blocked); libraryBar.show(!reading && !blocked)
        let reader = value["reader"] as? [String: Any] ?? [:]
        let visible = reading && reader["visible"] as? Bool == true && !blocked
        readerBar.show(visible); progressBar.show(visible)
        let count = value["bookCount"] as? Int ?? 0; let marks = value["bookmarkCount"] as? Int ?? 0
        controls["library"]?.title = "我的书架   \(count)"; controls["bookmarks"]?.title = "我的书签   \(marks)"
        window?.appearance = appearance; popover?.appearance = appearance
        let bookmarkView = value["bookmarkView"] as? Bool == true
        controls["library"]?.isBordered = !bookmarkView; controls["bookmarks"]?.isBordered = bookmarkView
        controls["library"]?.state = bookmarkView ? .off : .on; controls["bookmarks"]?.state = bookmarkView ? .on : .off
        libraryTitle.stringValue = bookmarkView ? "我的书签" : "我的书架"
        controls["connection"]?.toolTip = value["syncState"] as? String
        controls["sync"]?.isEnabled = value["busy"] as? Bool != true
        if search.currentEditor() == nil { search.stringValue = value["search"] as? String ?? "" }
        titleLabel.stringValue = reader["title"] as? String ?? ""; chapterLabel.stringValue = reader["chapter"] as? String ?? ""
        let progress = min(1, max(0, (reader["progress"] as? Double ?? 0).isFinite ? reader["progress"] as? Double ?? 0 : 0))
        slider.doubleValue = progress * 1000; percent.stringValue = "\(Int((progress * 100).rounded()))%"
        let pdf = reader["format"] as? String == "pdf"
        let items = pdf ? ["适合页面", "150%", "200%"] : ["自动", "UTF-8", "GB18030", "UTF-16 LE", "Big5"]
        if format.itemTitles != items { format.removeAllItems(); format.addItems(withTitles: items) }
        let selection = pdf ? [1.0, 1.5, 2.0].firstIndex(of: reader["zoom"] as? Double ?? 1) : ["auto", "utf-8", "gb18030", "utf-16le", "big5"].firstIndex(of: reader["encoding"] as? String ?? "auto")
        format.selectItem(at: selection ?? 0); format.setAccessibilityLabel(pdf ? "PDF 缩放" : "文本编码")
        let enabled = reader["loading"] as? Bool != true
        for id in ["contents", "find", "bookmark", "previous", "next"] { controls[id]?.isEnabled = enabled }
        slider.isEnabled = enabled; format.isEnabled = enabled
        needsLayout = true
    }
    override func layout() {
        super.layout()
        let w = bounds.width; let h = bounds.height
        sidebar.frame = NSRect(x: 12, y: 12, width: 208, height: max(400, h - 24))
        brandImage.frame = NSRect(x: 22, y: 25, width: 52, height: 52)
        brand.frame = NSRect(x: 86, y: 32, width: 104, height: 36)
        caption.frame = NSRect(x: 25, y: 105, width: 160, height: 16)
        controls["library"]?.frame = NSRect(x: 14, y: 134, width: 180, height: 40)
        controls["bookmarks"]?.frame = NSRect(x: 14, y: 180, width: 180, height: 40)
        note.frame = NSRect(x: 25, y: max(260, (h - 24) * 0.48), width: 160, height: 80)
        controls["settings"]?.frame = NSRect(x: 14, y: h - 130, width: 180, height: 40)
        controls["connection"]?.frame = NSRect(x: 14, y: h - 82, width: 180, height: 40)
        let shelfWidth = max(340, w - 260)
        libraryBar.frame = NSRect(x: 244, y: 12, width: shelfWidth, height: 56)
        libraryTitle.frame = NSRect(x: 20, y: 19, width: 100, height: 20)
        search.frame = NSRect(x: max(120, shelfWidth - 350), y: 13, width: min(230, shelfWidth - 230), height: 30)
        controls["import"]?.frame = NSRect(x: shelfWidth - 94, y: 10, width: 36, height: 36)
        controls["sync"]?.frame = NSRect(x: shelfWidth - 50, y: 10, width: 36, height: 36)
        let rw = min(800, w - 48)
        readerBar.frame = NSRect(x: (w - rw) / 2, y: 14, width: rw, height: 60)
        controls["close"]?.frame = NSRect(x: 12, y: 12, width: 36, height: 36)
        titleLabel.frame = NSRect(x: 62, y: 12, width: max(100, rw - 270), height: 20)
        chapterLabel.frame = NSRect(x: 62, y: 34, width: max(100, rw - 270), height: 15)
        for (index, id) in ["contents", "find", "bookmark", "readerSettings"].enumerated() {
            controls[id]?.frame = NSRect(x: rw - 182 + CGFloat(index) * 42, y: 12, width: 36, height: 36)
        }
        let pw = min(720, w - 64)
        progressBar.frame = NSRect(x: (w - pw) / 2, y: h - 76, width: pw, height: 56)
        controls["previous"]?.frame = NSRect(x: 10, y: 10, width: 32, height: 36)
        format.frame = NSRect(x: 48, y: 14, width: 106, height: 28)
        slider.frame = NSRect(x: 168, y: 16, width: max(80, pw - 280), height: 24)
        percent.frame = NSRect(x: pw - 102, y: 21, width: 48, height: 18)
        controls["next"]?.frame = NSRect(x: pw - 44, y: 10, width: 32, height: 36)
    }
    override func hitTest(_ point: NSPoint) -> NSView? {
        guard let hit = super.hitTest(point), hit !== self else { return nil }; return hit
    }
    @objc private func pressed(_ sender: NSButton) {
        let action = sender.identifier?.rawValue ?? ""
        if action == "settings" || action == "readerSettings" { showPreferences(); return }
        onAction?(action, nil); onAction?("activity", nil)
    }
    @objc private func searchChanged() { onAction?("search", search.stringValue) }
    @objc private func seek() { onAction?("seek", slider.doubleValue / 1000); onAction?("activity", nil) }
    @objc private func formatChanged() {
        let pdf = (state["reader"] as? [String: Any])?["format"] as? String == "pdf"
        let index = format.indexOfSelectedItem
        if pdf, (0..<3).contains(index) { onAction?("zoom", [1.0, 1.5, 2.0][index]) }
        else if (0..<5).contains(index) { onAction?("encoding", ["auto", "utf-8", "gb18030", "utf-16le", "big5"][index]) }
        onAction?("activity", nil)
    }
    func showPreferences() {
        if popover?.isShown == true { popover?.close(); return }
        let preferences = PreferencesController(state: state)
        preferences.changed = { [weak self] value in self?.onAction?("preferences", value) }
        let popup = NSPopover(); popup.behavior = .transient; popup.contentViewController = preferences; popup.delegate = self
        popover = popup; popup.appearance = appearance
        preferences.finished = { [weak self] in self?.popover?.close() }
        let anchor = controls[state["mode"] as? String == "reader" ? "readerSettings" : "settings"]!
        onAction?("preferencesVisible", true)
        popup.show(relativeTo: anchor.bounds, of: anchor, preferredEdge: .maxY)
    }
    func popoverDidClose(_ notification: Notification) { popover = nil; onAction?("preferencesVisible", false) }
}

final class PreferencesController: NSViewController, NSTextFieldDelegate {
    var changed: (([String: Any]) -> Void)?
    var finished: (() -> Void)?
    private let theme = NSSegmentedControl(labels: ["纸白", "暖纸", "夜色"], trackingMode: .selectOne, target: nil, action: nil)
    private let font = NSSlider(value: 20, minValue: 15, maxValue: 32, target: nil, action: nil)
    private let margin = NSSlider(value: 0, minValue: 0, maxValue: 35, target: nil, action: nil)
    private let animation = NSPopUpButton(frame: .zero, pullsDown: false)
    private let sizeLabel = NSTextField(labelWithString: "正文字号")
    private let marginLabel = NSTextField(labelWithString: "左右留白（每侧 %）")
    private let marginInput = NSTextField(string: "0")
    private let initial: [String: Any]
    init(state: [String: Any]) { initial = state; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func loadView() {
        view = FlippedSurface(frame: NSRect(x: 0, y: 0, width: 310, height: 356))
        let title = NSTextField(labelWithString: "阅读偏好"); title.font = .systemFont(ofSize: 18, weight: .semibold); title.frame = NSRect(x: 24, y: 22, width: 260, height: 24); view.addSubview(title)
        let label = NSTextField(labelWithString: "书页主题"); label.frame = NSRect(x: 24, y: 62, width: 260, height: 18); label.font = .systemFont(ofSize: 12); view.addSubview(label)
        theme.frame = NSRect(x: 24, y: 86, width: 262, height: 30); theme.selectedSegment = ["paper", "sepia", "night"].firstIndex(of: initial["theme"] as? String ?? "paper") ?? 0
        theme.target = self; theme.action = #selector(updateSettings); theme.setAccessibilityLabel("书页主题"); view.addSubview(theme)
        sizeLabel.frame = NSRect(x: 24, y: 134, width: 260, height: 18); sizeLabel.font = .systemFont(ofSize: 12); view.addSubview(sizeLabel)
        font.frame = NSRect(x: 24, y: 160, width: 262, height: 24); font.doubleValue = initial["fontSize"] as? Double ?? 20
        font.numberOfTickMarks = 18; font.allowsTickMarkValuesOnly = true; font.isContinuous = true; font.target = self; font.action = #selector(updateSettings); font.setAccessibilityLabel("正文字号"); view.addSubview(font)
        marginLabel.frame = NSRect(x: 24, y: 198, width: 180, height: 18); marginLabel.font = .systemFont(ofSize: 12); view.addSubview(marginLabel)
        margin.frame = NSRect(x: 24, y: 222, width: 262, height: 24); margin.doubleValue = initial["pageMargin"] as? Double ?? 0
        margin.numberOfTickMarks = 0; margin.allowsTickMarkValuesOnly = false; margin.isContinuous = true; margin.target = self; margin.action = #selector(updateSettings); margin.setAccessibilityLabel("左右留白，每侧百分比"); view.addSubview(margin)
        marginInput.frame = NSRect(x: 224, y: 194, width: 62, height: 24); marginInput.alignment = .right
        let formatter = NumberFormatter(); formatter.minimum = 0; formatter.maximum = 35; formatter.maximumFractionDigits = 1; formatter.allowsFloats = true
        marginInput.formatter = formatter; marginInput.delegate = self; marginInput.target = self; marginInput.action = #selector(commitMargin)
        marginInput.setAccessibilityLabel("左右留白百分比，0 到 35"); view.addSubview(marginInput)
        let turnLabel = NSTextField(labelWithString: "翻页方式"); turnLabel.frame = NSRect(x: 24, y: 268, width: 76, height: 22); turnLabel.font = .systemFont(ofSize: 12); view.addSubview(turnLabel)
        animation.frame = NSRect(x: 112, y: 263, width: 174, height: 30); animation.addItems(withTitles: ["轻盈滑动", "覆盖翻页", "书页翻转", "直接翻页"])
        animation.selectItem(at: ["slide", "cover", "flip", "none"].firstIndex(of: initial["animation"] as? String ?? "slide") ?? 0)
        animation.target = self; animation.action = #selector(updateSettings); animation.setAccessibilityLabel("翻页方式"); view.addSubview(animation)
        let done = NSButton(title: "完成", target: self, action: #selector(finish)); done.bezelStyle = .rounded; done.frame = NSRect(x: 206, y: 310, width: 80, height: 30); view.addSubview(done)
        sizeLabel.stringValue = "正文字号 · \(Int(font.doubleValue))"
        marginInput.doubleValue = margin.doubleValue
    }
    @objc private func updateSettings() {
        sizeLabel.stringValue = "正文字号 · \(Int(font.doubleValue))"
        marginInput.doubleValue = margin.doubleValue
        changed?(["theme": ["paper", "sepia", "night"][max(0, theme.selectedSegment)], "fontSize": font.doubleValue.rounded(), "pageMargin": (margin.doubleValue * 10).rounded() / 10, "animation": ["slide", "cover", "flip", "none"][max(0, animation.indexOfSelectedItem)]])
    }
    @objc private func commitMargin() {
        let value = marginInput.doubleValue
        margin.doubleValue = value.isFinite ? min(35, max(0, value)) : 0
        updateSettings()
    }
    func controlTextDidEndEditing(_ notification: Notification) { commitMargin() }
    @objc private func finish() { finished?() }
}
