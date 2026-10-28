import Cocoa

_ = NSApplication.shared
let preferences = PreferencesController(state: ["pageMargin": 12.5, "fontSize": 20, "theme": "paper", "animation": "slide"])
let surface = preferences.view
let input = surface.subviews.compactMap { $0 as? NSTextField }.first { $0.accessibilityLabel() == "左右留白百分比，0 到 35" }!
let slider = surface.subviews.compactMap { $0 as? NSSlider }.first { $0.accessibilityLabel() == "左右留白，每侧百分比" }!
precondition(input.doubleValue == 12.5 && slider.doubleValue == 12.5)
var emitted: Double = -1
preferences.changed = { emitted = $0["pageMargin"] as? Double ?? -1 }
input.doubleValue = 23.7
input.sendAction(input.action!, to: input.target)
precondition(emitted == 23.7 && slider.doubleValue == 23.7)
slider.doubleValue = 0
slider.sendAction(slider.action!, to: slider.target)
precondition(emitted == 0 && input.doubleValue == 0)
slider.doubleValue = 35
slider.sendAction(slider.action!, to: slider.target)
precondition(emitted == 35 && input.doubleValue == 35)
print("Mac native margin controls: restore, typed percentage, live slider and limits passed")
