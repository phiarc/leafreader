import Foundation
import CryptoKit
import LocalAuthentication
import Security
import Darwin

// Device-bound encrypted storage avoids tying a development build's credential
// to its changing ad-hoc code hash. No plaintext key or token is written to disk.
final class TokenVault {
    private struct Envelope: Codable {
        let version: Int
        let wrappedKey: Data
        let peerPublicKey: Data
        let salt: Data
        let sealedToken: Data
    }
    enum VaultError: LocalizedError {
        case unavailable, invalidCredential, invalidRecord, storage
        var errorDescription: String? {
            switch self {
            case .unavailable: return "当前设备无法使用安全的自动连接，请重新连接。"
            case .invalidCredential: return "连接码无效，请重新输入。"
            case .invalidRecord: return "保存的同步连接无法读取，请重新连接。"
            case .storage: return "无法保存同步连接，请检查应用数据目录后重试。"
            }
        }
    }
    static let defaultDirectory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        .appendingPathComponent("com.leafreader.desktop", isDirectory: true)
    private static let context = Data("com.leafreader.desktop/sync-token/v1".utf8)
    private let directory: URL
    private let file: URL
    private let lock = NSLock()
    private var cached: String?
    init(directory: URL = TokenVault.defaultDirectory) {
        self.directory = directory; self.file = directory.appendingPathComponent("sync-credential.v1")
    }
    private func authenticationContext() -> LAContext {
        let context = LAContext(); context.interactionNotAllowed = true
        return context
    }
    private func ensureDirectory() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let values = try directory.resourceValues(forKeys: [.isSymbolicLinkKey, .isDirectoryKey])
        guard values.isSymbolicLink != true, values.isDirectory == true else { throw VaultError.storage }
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory.path)
    }
    func read() throws -> String {
        lock.lock(); defer { lock.unlock() }
        if let cached = cached { return cached }
        guard FileManager.default.fileExists(atPath: file.path) else { cached = ""; return "" }
        guard SecureEnclave.isAvailable else { throw VaultError.unavailable }
        do {
            let values = try file.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey, .fileSizeKey])
            guard values.isSymbolicLink != true, values.isRegularFile == true, (values.fileSize ?? 0) <= 32768 else { throw VaultError.invalidRecord }
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: file.path)
            let record = try PropertyListDecoder().decode(Envelope.self, from: Data(contentsOf: file))
            guard record.version == 1, record.salt.count == 32, record.peerPublicKey.count == 65 else { throw VaultError.invalidRecord }
            let context = authenticationContext()
            let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: record.wrappedKey, authenticationContext: context)
            let publicKey = try P256.KeyAgreement.PublicKey(x963Representation: record.peerPublicKey)
            let shared = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
            let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: record.salt, sharedInfo: Self.context, outputByteCount: 32)
            let plaintext = try AES.GCM.open(AES.GCM.SealedBox(combined: record.sealedToken), using: key, authenticating: Self.context)
            guard let token = String(data: plaintext, encoding: .utf8), (32...16384).contains(plaintext.count) else { throw VaultError.invalidRecord }
            cached = token; return token
        } catch { throw VaultError.invalidRecord }
    }
    func save(_ token: String) throws {
        lock.lock(); defer { lock.unlock() }
        if token.isEmpty { try clearUnlocked(); return }
        let plaintext = Data(token.utf8)
        guard (32...16384).contains(plaintext.count) else { throw VaultError.invalidCredential }
        guard SecureEnclave.isAvailable else { throw VaultError.unavailable }
        let context = authenticationContext()
        // The default access control binds the key to this unlocked user/device
        // without userPresence or biometry flags. Interaction is explicitly denied.
        let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(authenticationContext: context)
        let peer = P256.KeyAgreement.PrivateKey()
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: peer.publicKey)
        var salt = Data(count: 32)
        let status = salt.withUnsafeMutableBytes { bytes in SecRandomCopyBytes(kSecRandomDefault, bytes.count, bytes.baseAddress!) }
        guard status == errSecSuccess else { throw VaultError.storage }
        let key = shared.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: Self.context, outputByteCount: 32)
        guard let ciphertext = try AES.GCM.seal(plaintext, using: key, authenticating: Self.context).combined else { throw VaultError.storage }
        let record = Envelope(version: 1, wrappedKey: privateKey.dataRepresentation, peerPublicKey: peer.publicKey.x963Representation, salt: salt, sealedToken: ciphertext)
        let encoder = PropertyListEncoder(); encoder.outputFormat = .binary
        let data = try encoder.encode(record)
        try ensureDirectory()
        let temporary = directory.appendingPathComponent(".credential-\(UUID().uuidString)")
        let descriptor = Darwin.open(temporary.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, mode_t(0o600))
        guard descriptor >= 0 else { throw VaultError.storage }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        defer { try? handle.close(); try? FileManager.default.removeItem(at: temporary) }
        try handle.write(contentsOf: data); try handle.synchronize(); try handle.close()
        guard Darwin.rename(temporary.path, file.path) == 0 else { throw VaultError.storage }
        cached = token
    }
    func clear() throws { lock.lock(); defer { lock.unlock() }; try clearUnlocked() }
    private func clearUnlocked() throws {
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
        cached = ""
    }
}
