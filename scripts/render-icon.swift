import Foundation
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// Packaging mask: a precise vector silhouette removes stray transparent-edge pixels.
// The generated artwork is kept intact inside the clip; the exterior is real alpha.
let source = URL(fileURLWithPath: CommandLine.arguments[1])
let output = URL(fileURLWithPath: CommandLine.arguments[2])
let harmony = CommandLine.arguments.count > 3 && CommandLine.arguments[3] == "harmony"
guard let imageSource = CGImageSourceCreateWithURL(source as CFURL, nil),
      let artwork = CGImageSourceCreateImageAtIndex(imageSource, 0, nil),
      let context = CGContext(data: nil, width: 1024, height: 1024, bitsPerComponent: 8, bytesPerRow: 4096,
        space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("Icon source unavailable") }
context.clear(CGRect(x: 0, y: 0, width: 1024, height: 1024))
let face = harmony ? CGRect(x: 0, y: 0, width: 1024, height: 1024) : CGRect(x: 108, y: 108, width: 808, height: 808)
let radius: CGFloat = harmony ? 210 * 1024 / 808 : 210
context.addPath(CGPath(roundedRect: face, cornerWidth: radius, cornerHeight: radius, transform: nil))
context.clip()
context.setFillColor(CGColor(red: 0.965, green: 0.929, blue: 0.859, alpha: 1))
context.fill(CGRect(x: 0, y: 0, width: 1024, height: 1024))
context.interpolationQuality = .high
// Harmony's input is the finished Mac PNG. Remove only its Dock padding.
let renderedArtwork: CGImage
if harmony {
    guard artwork.width == 1024, artwork.height == 1024,
          let cropped = artwork.cropping(to: CGRect(x: 108, y: 108, width: 808, height: 808)) else { fatalError("Invalid rounded icon dimensions") }
    renderedArtwork = cropped
} else { renderedArtwork = artwork }
context.draw(renderedArtwork, in: CGRect(x: 0, y: 0, width: 1024, height: 1024))
guard let image = context.makeImage(), let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil) else { fatalError("Icon output unavailable") }
CGImageDestinationAddImage(destination, image, nil)
guard CGImageDestinationFinalize(destination) else { fatalError("Icon PNG could not be saved") }
