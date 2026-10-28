import Foundation
import CryptoKit
#if VAULT_READER
let variant = "rebuilt-reader"
#else
let variant = "writer"
#endif
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let vault = TokenVault(directory: directory)
let first = "leaf-vault-fixture-not-an-actual-connection-token-0001"
let second = "leaf-vault-fixture-not-an-actual-connection-token-0002"
let file = directory.appendingPathComponent("sync-credential.v1")
func require(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
    if !(try value()) { throw NSError(domain: "TokenVaultTest", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}
do {
    switch CommandLine.arguments[2] {
    case "write":
        try require(try vault.read() == "", "new vault must start empty")
        try vault.save(first)
        try require(try vault.read() == first, "cached credential must match")
        let data = try Data(contentsOf: file)
        try require(data.range(of: Data(first.utf8)) == nil, "plaintext must not appear in the record")
        let fileMode = try FileManager.default.attributesOfItem(atPath: file.path)[.posixPermissions] as! NSNumber
        let directoryMode = try FileManager.default.attributesOfItem(atPath: directory.path)[.posixPermissions] as! NSNumber
        try require(fileMode.intValue == 0o600 && directoryMode.intValue == 0o700, "private permissions required")
    case "read": try require(try vault.read() == first, "credential must survive process and code hash changes")
    case "tamper":
        var data = try Data(contentsOf: file); data[data.count / 2] ^= 1; try data.write(to: file)
    case "reject-tamper":
        var rejected = false
        do { _ = try vault.read() } catch { rejected = true }
        try require(rejected, "modified record must be rejected")
    case "replace": try vault.save(second)
    case "read-replaced": try require(try vault.read() == second, "replacement must persist")
    case "clear": try vault.save(""); try require(try vault.read() == "", "disconnect must clear cached token")
    case "empty": try require(try vault.read() == "", "disconnected token must not return on next launch")
    default: throw NSError(domain: "TokenVaultTest", code: 2)
    }
    print("\(variant): \(CommandLine.arguments[2]) passed")
} catch { print("Vault check failed: \(error.localizedDescription)"); exit(1) }
