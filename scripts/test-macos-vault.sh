#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/tests .cache/swift
VAULT_TEST_DIR="$(mktemp -d "$PWD/build/tests/vault.XXXXXX")"
trap 'rm -rf "$VAULT_TEST_DIR"' EXIT
mkdir -p "$VAULT_TEST_DIR/writer" "$VAULT_TEST_DIR/reader"
cp tests/macos-vault.swift "$VAULT_TEST_DIR/writer/main.swift"
cp tests/macos-vault.swift "$VAULT_TEST_DIR/reader/main.swift"
xcrun swiftc -O -module-cache-path .cache/swift apps/macos/TokenVault.swift "$VAULT_TEST_DIR/writer/main.swift" -o "$VAULT_TEST_DIR/writer/check"
xcrun swiftc -O -DVAULT_READER -module-cache-path .cache/swift apps/macos/TokenVault.swift "$VAULT_TEST_DIR/reader/main.swift" -o "$VAULT_TEST_DIR/reader/check"
codesign --force --sign - --identifier com.leafreader.vault-test "$VAULT_TEST_DIR/writer/check"
codesign --force --sign - --identifier com.leafreader.vault-test "$VAULT_TEST_DIR/reader/check"
"$VAULT_TEST_DIR/writer/check" "$VAULT_TEST_DIR/data" write
"$VAULT_TEST_DIR/reader/check" "$VAULT_TEST_DIR/data" read
"$VAULT_TEST_DIR/writer/check" "$VAULT_TEST_DIR/data" tamper
"$VAULT_TEST_DIR/reader/check" "$VAULT_TEST_DIR/data" reject-tamper
"$VAULT_TEST_DIR/writer/check" "$VAULT_TEST_DIR/data" replace
"$VAULT_TEST_DIR/reader/check" "$VAULT_TEST_DIR/data" read-replaced
"$VAULT_TEST_DIR/writer/check" "$VAULT_TEST_DIR/data" clear
"$VAULT_TEST_DIR/reader/check" "$VAULT_TEST_DIR/data" empty
