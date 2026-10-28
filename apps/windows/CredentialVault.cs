using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace LeafReader;

internal sealed class CredentialVault(string directory)
{
    private static readonly byte[] Entropy = SHA256.HashData(Encoding.UTF8.GetBytes("com.leafreader.windows/sync/v1"));
    private readonly string file = Path.Combine(directory, "sync-credential.v1");
    private string? cached;

    internal string Read()
    {
        if (cached is not null) return cached;
        if (!File.Exists(file)) return cached = "";
        try
        {
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0 || new FileInfo(file).Length > 32768) throw new CryptographicException();
            byte[] protectedBytes = File.ReadAllBytes(file);
            byte[] bytes = ProtectedData.Unprotect(protectedBytes, Entropy, DataProtectionScope.CurrentUser);
            try
            {
                string token = Encoding.UTF8.GetString(bytes);
                if (bytes.Length is < 32 or > 16384) throw new CryptographicException();
                return cached = token;
            }
            finally { CryptographicOperations.ZeroMemory(bytes); }
        }
        catch (Exception error) when (error is CryptographicException or IOException or UnauthorizedAccessException)
        { throw new InvalidOperationException("保存的同步连接无法读取，请重新连接。", error); }
    }

    internal void Save(string token)
    {
        if (token.Length == 0)
        {
            File.Delete(file);
            cached = "";
            return;
        }
        byte[] bytes = Encoding.UTF8.GetBytes(token);
        if (bytes.Length is < 32 or > 16384) throw new InvalidOperationException("请输入完整的同步连接码。");
        byte[] encrypted;
        try { encrypted = ProtectedData.Protect(bytes, Entropy, DataProtectionScope.CurrentUser); }
        finally { CryptographicOperations.ZeroMemory(bytes); }
        Directory.CreateDirectory(directory);
        if ((File.GetAttributes(directory) & FileAttributes.ReparsePoint) != 0) throw new IOException("同步连接目录无效。");
        string temporary = Path.Combine(directory, ".credential-" + Guid.NewGuid().ToString("N"));
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            { stream.Write(encrypted); stream.Flush(true); }
            File.Move(temporary, file, true);
            cached = token;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
}
