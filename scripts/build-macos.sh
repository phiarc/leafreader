#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
APP="build/macos/页间.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/web" .cache/swift
/usr/bin/rsync -a --delete dist/ "$APP/Contents/Resources/web/"
cp apps/macos/Resources/LeafReader.icns "$APP/Contents/Resources/LeafReader.icns"
cp apps/macos/Resources/LeafLogo.png "$APP/Contents/Resources/LeafLogo.png"
cp apps/macos/Info.plist "$APP/Contents/Info.plist"
xcrun swiftc -O -module-cache-path .cache/swift -target arm64-apple-macosx13.0 -framework Cocoa -framework WebKit -framework Network -framework Security -framework CryptoKit -framework LocalAuthentication apps/macos/NativeChrome.swift apps/macos/ReaderWebView.swift apps/macos/TokenVault.swift apps/macos/BlobTransfer.swift apps/macos/main.swift -o "$APP/Contents/MacOS/LeafReader"
codesign --force --deep --sign - "$APP"
echo "macOS 应用已构建：$APP"
