import Cocoa
import WebKit

// WebKit's internal child views may consume scrollWheel before WKWebView's
// responder method. A local monitor sees phases reliably, only for this window
// and gestures that start on this web view; native chrome is left untouched.
final class ReaderWebView: WKWebView {
    var readerGesturesEnabled = false
    var onTrackpadPhase: ((String) -> Void)?
    private enum Axis { case undecided, horizontal, vertical }
    private var axis: Axis = .undecided
    private var usingPhases = false
    private var ownsGesture = false
    private var monitor: Any?
    override init(frame: NSRect, configuration: WKWebViewConfiguration) {
        super.init(frame: frame, configuration: configuration); installMonitor()
    }
    required init?(coder: NSCoder) { super.init(coder: coder); installMonitor() }
    deinit { if let monitor = monitor { NSEvent.removeMonitor(monitor) } }
    private func installMonitor() {
        monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
            guard let self = self else { return event }; return self.track(event)
        }
    }
    private func targetsWeb(_ event: NSEvent) -> Bool {
        guard let content = window?.contentView else { return false }
        let point = content.superview?.convert(event.locationInWindow, from: nil) ?? event.locationInWindow
        guard let hit = content.hitTest(point) else { return false }
        return hit === self || hit.isDescendant(of: self)
    }
    private func cancelTracking() {
        if usingPhases || axis == .horizontal { onTrackpadPhase?("cancel") }
        axis = .undecided; usingPhases = false; ownsGesture = false
    }
    private func track(_ event: NSEvent) -> NSEvent? {
        guard let ownWindow = window, event.window === ownWindow else { return event }
        guard readerGesturesEnabled, !event.modifierFlags.contains(.control), !event.modifierFlags.contains(.command) else {
            cancelTracking(); return event
        }
        if !event.hasPreciseScrollingDeltas || (event.phase.isEmpty && event.momentumPhase.isEmpty) {
            guard targetsWeb(event) else { return event }
            if usingPhases { onTrackpadPhase?("fallback"); usingPhases = false }
            axis = .undecided; ownsGesture = false; return event
        }
        if event.phase.contains(.began) {
            ownsGesture = targetsWeb(event); axis = .undecided
        }
        guard ownsGesture else { return event }
        if !event.momentumPhase.isEmpty {
            let consume = axis == .horizontal
            if event.momentumPhase.contains(.ended) || event.momentumPhase.contains(.cancelled) {
                axis = .undecided; ownsGesture = false
            }
            return consume ? nil : event
        }
        if axis == .undecided {
            let x = abs(event.scrollingDeltaX); let y = abs(event.scrollingDeltaY)
            if x > 1 && x > y * 1.15 { axis = .horizontal; usingPhases = true; onTrackpadPhase?("begin") }
            else if y > 1 && y > x * 1.15 { axis = .vertical }
        }
        if axis == .horizontal && (event.phase.contains(.ended) || event.phase.contains(.cancelled)) {
            // Let WebKit finish its own native scrolling lifecycle as well.
            onTrackpadPhase?(event.phase.contains(.cancelled) ? "cancel" : "end")
        }
        return event
    }
}
