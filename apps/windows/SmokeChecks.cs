using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace LeafReader;

internal static class SmokeChecks
{
    private static readonly List<string> checks = [];
    private const string Token = "windows-native-smoke-fixture-not-a-real-connection-code-0001";
    private static string Option(string[] args, string key, string fallback = "")
    { int index = Array.IndexOf(args, key); return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback; }
    private static void Check(bool value, string name) { if (!value) throw new InvalidOperationException("Smoke check failed: " + name); checks.Add(name); }
    private static void Rejected(Action operation, string name)
    { bool rejected = false; try { operation(); } catch (InvalidOperationException) { rejected = true; } Check(rejected, name); }
    private static async Task Wait(ReaderWindow window, string expression, int seconds = 30)
    {
        DateTime until = DateTime.UtcNow.AddSeconds(seconds);
        while (DateTime.UtcNow < until)
        {
            if (await window.Browser.CoreWebView2.ExecuteScriptAsync($"Boolean({expression})") == "true") return;
            await Task.Delay(100);
        }
        throw new TimeoutException("Reader condition timed out: " + expression);
    }
    private static async Task<string> Text(ReaderWindow window) => JsonSerializer.Deserialize<string>(
        await window.Browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.page-content')?.textContent || ''")) ?? "";
    private static async Task Script(ReaderWindow window, string script) => await window.Browser.CoreWebView2.ExecuteScriptAsync(script);
    private static async Task<JsonElement> PageRequest(ReaderWindow window, string method, object args)
    {
        string id = "smoke-" + Guid.NewGuid().ToString("N");
        string request = JsonSerializer.Serialize(new { id, method, args });
        await Script(window, "window.__smokeReplies ||= {}; if(!window.__smokeReplyHooked){const old=window.__leafReply; window.__leafReply=r=>{window.__smokeReplies[r.id]=r;old(r)};window.__smokeReplyHooked=true;}" +
            $"window.LeafNative.postMessage(JSON.stringify({request}));");
        await Wait(window, $"window.__smokeReplies[{JsonSerializer.Serialize(id)}] !== undefined");
        using var reply = JsonDocument.Parse(await window.Browser.CoreWebView2.ExecuteScriptAsync($"window.__smokeReplies[{JsonSerializer.Serialize(id)}]"));
        if (reply.RootElement.TryGetProperty("error", out var error)) throw new InvalidOperationException(error.GetString());
        return reply.RootElement.GetProperty("result").Clone();
    }
    private static async Task Import(ReaderWindow window, string file)
    {
        using var document = JsonDocument.Parse(await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.getDocument", "{}"));
        int root = document.RootElement.GetProperty("root").GetProperty("nodeId").GetInt32();
        using var selection = JsonDocument.Parse(await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.querySelector", JsonSerializer.Serialize(new { nodeId = root, selector = "input[type=file]" })));
        int input = selection.RootElement.GetProperty("nodeId").GetInt32();
        await window.Browser.CoreWebView2.CallDevToolsProtocolMethodAsync("DOM.setFileInputFiles", JsonSerializer.Serialize(new { nodeId = input, files = new[] { Path.GetFullPath(file) } }));
    }
    internal static async Task Run(ReaderWindow window, string directory, string[] args)
    {
        await Wait(window, "document.querySelector('.book-card') && window.__leafReply");
        Check(await window.Browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.app-shell').dataset.platform") == "\"windows\"", "Windows platform bridge initialized");
        Check(ReaderWindow.TrustedDocument(ReaderWindow.ReaderOrigin + "/index.html"), "Packaged document accepted");
        Check(!ReaderWindow.TrustedDocument("https://leaf-reader.invalid.attacker.example/index.html"), "Foreign origin blocked");
        Rejected(() => NetworkClient.CloudAddress("https://name:password@example.com/api", "/v1/health"), "Embedded URL credentials blocked");
        Rejected(() => NetworkClient.CloudAddress("http://example.com/api", "/v1/health"), "Plain HTTP service blocked");
        Rejected(() => NetworkClient.BlobAddress("https://example.com/leaf-books/a?sig=fixture", "GET"), "Foreign file host blocked");
        Rejected(() => NetworkClient.BlobAddress("https://fixture.blob.core.windows.net/leaf-books/a?sig=fixture", "PUT"), "Unbounded file PUT blocked");

        await PageRequest(window, "setSecret", new { token = Token });
        Check((await PageRequest(window, "getSecret", new { })).GetString() == Token, "Native credential bridge round trip");
        var reopened = new CredentialVault(directory);
        Check(reopened.Read() == Token, "DPAPI credential survives a new vault instance");
        byte[] ciphertext = File.ReadAllBytes(Path.Combine(directory, "sync-credential.v1"));
        Check(!Encoding.UTF8.GetString(ciphertext).Contains(Token), "Credential file excludes plaintext");
        await PageRequest(window, "setSecret", new { token = "" });
        Check(new CredentialVault(directory).Read() == "", "Disconnect removes persistent credential");

        string fixture = Path.Combine(directory, "Windows 阅读验证.txt");
        File.WriteAllText(fixture, "第一章 春天\n\n" + string.Concat(Enumerable.Repeat("清风穿过书页，我们沿着溪流继续向前。", 800)) + "\n第二章 夏天\n正文接着标题。", new UTF8Encoding(false));
        await Import(window, fixture);
        await Wait(window, "document.querySelector('[aria-label=\"阅读 Windows 阅读验证\"]')");
        await Script(window, "document.querySelector('[aria-label=\"阅读 Windows 阅读验证\"]').click()");
        await Wait(window, "document.querySelector('.page-content')?.textContent.includes('第一章 春天')");
        Check((await Text(window)).Contains("清风穿过书页"), "Native file import and TXT rendering");
        string first = await Text(window);
        await Script(window, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight'}))");
        await Wait(window, $"document.querySelector('.page-content')?.textContent !== {JsonSerializer.Serialize(first)}");
        string later = await Text(window);
        Check(later.Length > 20, "Keyboard page turn");
        await Script(window, "document.querySelector('.reading-paper').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
        Check(await window.Browser.CoreWebView2.ExecuteScriptAsync("document.querySelector('.reader').classList.contains('controls-hidden')") == "false", "Double click reveals reading controls");
        await Script(window, "document.querySelector('[aria-label=\"返回书架\"]').click()");
        await Wait(window, "!document.querySelector('.reader')");
        // Wait for pending position persistence, then the actual navigation boundary.
        await Task.Delay(250);
        var reloaded = new TaskCompletionSource<bool>();
        void Reloaded(object? _, Microsoft.Web.WebView2.Core.CoreWebView2NavigationCompletedEventArgs e)
        { window.Browser.CoreWebView2.NavigationCompleted -= Reloaded; reloaded.TrySetResult(e.IsSuccess); }
        window.Browser.CoreWebView2.NavigationCompleted += Reloaded;
        window.Browser.CoreWebView2.Reload();
        if (!await reloaded.Task.WaitAsync(TimeSpan.FromSeconds(30))) throw new InvalidOperationException("Reader reload failed.");
        await Wait(window, "document.querySelector('[aria-label=\"阅读 Windows 阅读验证\"]')");
        await Script(window, "document.querySelector('[aria-label=\"阅读 Windows 阅读验证\"]').click()");
        await Wait(window, $"document.querySelector('.page-content')?.textContent === {JsonSerializer.Serialize(later)}");
        Check(true, "Reading position survives page restart");
        await Script(window, "document.querySelector('[aria-label=\"返回书架\"]').click()");
        await Wait(window, "!document.querySelector('.reader')");
        string pdf = Option(args, "--pdf-fixture");
        if (!File.Exists(pdf)) throw new FileNotFoundException("A synthetic PDF fixture must be supplied to smoke checks.");
        await Import(window, pdf);
        string title = Path.GetFileNameWithoutExtension(pdf);
        string selector = "[aria-label=\"阅读 " + title + "\"]";
        await Wait(window, $"document.querySelector({JsonSerializer.Serialize(selector)})");
        await Script(window, $"document.querySelector({JsonSerializer.Serialize(selector)}).click()");
        await Wait(window, "document.querySelector('.pdf-paper canvas')?.width > 0 && !document.querySelector('.reading-message')", 60);
        Check(true, "PDF worker, fonts and first page render");

        if (args.Contains("--local-sync"))
        {
            const string endpoint = "http://127.0.0.1:7071/api";
            JsonElement health = await PageRequest(window, "cloudRequest", new { endpoint, token = Token, method = "GET", path = "/v1/health" });
            Check(health.GetProperty("status").GetInt32() == 200, "Native HTTP bridge authenticated health");
            string id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("windows-native-smoke-progress"))).ToLowerInvariant();
            var position = new { locatorVersion = 1, locator = new { type = "txt", offset = 127 }, progress = .25, baseRevision = 0, deviceId = "windows-smoke-device", operationId = Guid.NewGuid().ToString() };
            JsonElement saved = await PageRequest(window, "cloudRequest", new { endpoint, token = Token, method = "PUT", path = $"/v1/books/{id}/progress", body = position });
            Check(saved.GetProperty("status").GetInt32() == 200, "Native HTTP bridge writes reading progress");
            JsonElement read = await PageRequest(window, "cloudRequest", new { endpoint, token = Token, method = "GET", path = $"/v1/books/{id}/progress" });
            Check(read.GetProperty("data").GetProperty("locator").GetProperty("offset").GetInt32() == 127, "Native HTTP bridge reads reading progress");
        }
        string report = Option(args, "--report", Path.Combine(directory, "smoke-report.json"));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
        File.WriteAllText(report, JsonSerializer.Serialize(new { passed = true, platform = "Windows", checks, browser = window.Browser.CoreWebView2.Environment.BrowserVersionString }, new JsonSerializerOptions { WriteIndented = true }));
    }
    internal static void WriteFailure(string[] args, Exception error)
    {
        string report = Option(args, "--report", Path.Combine(Path.GetTempPath(), "leaf-reader-smoke-failure.json"));
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(report))!);
        File.WriteAllText(report, JsonSerializer.Serialize(new { passed = false, checks, error = error.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
