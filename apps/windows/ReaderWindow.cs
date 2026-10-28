using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Microsoft.Win32;

namespace LeafReader;

internal sealed class ReaderWindow : Window
{
    internal const string ReaderOrigin = "https://leaf-reader.invalid";
    internal readonly WebView2 Browser = new();
    internal readonly CredentialVault Vault;
    internal readonly NetworkClient Network = new();
    private readonly string dataDirectory;
    private readonly bool smoke;
    private readonly string[] arguments;
    private readonly HashSet<string> activeRequests = [];
    private bool closing;
    internal int ExitCode { get; private set; }

    internal ReaderWindow(string directory, bool smoke, string[] arguments)
    {
        dataDirectory = directory; this.smoke = smoke; this.arguments = arguments;
        Vault = new CredentialVault(directory);
        Title = "页间 · Leaf Reader"; Width = 1180; Height = 830; MinWidth = 740; MinHeight = 560;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        Background = new SolidColorBrush(Color.FromRgb(247, 246, 242));
        string icon = Path.Combine(AppContext.BaseDirectory, "LeafReader.ico");
        if (File.Exists(icon)) Icon = BitmapFrame.Create(new Uri(icon));
        Content = Browser;
        Loaded += async (_, _) =>
        {
            try
            {
                await InitializeBrowser();
                if (smoke) { await SmokeChecks.Run(this, dataDirectory, arguments); Application.Current.Shutdown(0); }
            }
            catch (Exception error)
            {
                ExitCode = 1;
                if (smoke) { SmokeChecks.WriteFailure(arguments, error); Application.Current.Shutdown(1); }
                else if (error is WebView2RuntimeNotFoundException)
                    MessageBox.Show("请先安装 Microsoft Edge WebView2 Runtime，再打开页间。\n下载地址：https://developer.microsoft.com/microsoft-edge/webview2/", "页间暂时无法打开", MessageBoxButton.OK, MessageBoxImage.Information);
                else MessageBox.Show("阅读界面无法启动，请重新打开或重新解压完整应用目录。", "页间暂时无法打开", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        };
        Closed += (_, _) => { closing = true; Browser.Dispose(); Network.Dispose(); };
    }

    private async Task InitializeBrowser()
    {
        string web = Path.Combine(AppContext.BaseDirectory, "web");
        if (!File.Exists(Path.Combine(web, "index.html"))) throw new FileNotFoundException("缺少打包后的阅读资源。");
        var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(dataDirectory, "WebView2"),
            new CoreWebView2EnvironmentOptions(smoke ? "--disable-gpu" : ""));
        await Browser.EnsureCoreWebView2Async(environment);
        Browser.DefaultBackgroundColor = System.Drawing.Color.FromArgb(247, 246, 242);
        var core = Browser.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("leaf-reader.invalid", web, CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDevToolsEnabled = smoke || arguments.Contains("--devtools");
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.NewWindowRequested += (_, e) => e.Handled = true;
        core.NavigationStarting += (_, e) => { if (!TrustedDocument(e.Uri)) e.Cancel = true; };
        core.FrameNavigationStarting += (_, e) => e.Cancel = true;
        core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
        core.WebMessageReceived += HandleMessage;
        await core.AddScriptToExecuteOnDocumentCreatedAsync("""
            if (window === window.top && location.origin === 'https://leaf-reader.invalid') {
              window.__leafNativePlatform = 'windows';
              window.__leafNativeChrome = false;
              window.LeafNative = { postMessage: message => window.chrome.webview.postMessage(message) };
            }
            """);
        core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (_, e) =>
        {
            if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https" &&
                !(uri.Scheme == "https" && uri.Host == "leaf-reader.invalid" && uri.IsDefaultPort))
                e.Response = environment.CreateWebResourceResponse(Stream.Null, 403, "Blocked", "Content-Type: text/plain");
        };
        var navigation = new TaskCompletionSource<bool>();
        void Completed(object? _, CoreWebView2NavigationCompletedEventArgs e) { core.NavigationCompleted -= Completed; navigation.TrySetResult(e.IsSuccess); }
        core.NavigationCompleted += Completed;
        core.Navigate(ReaderOrigin + "/index.html");
        if (!await navigation.Task.WaitAsync(TimeSpan.FromSeconds(30))) throw new InvalidOperationException("本机阅读资源加载失败。");
    }
    internal static bool TrustedDocument(string source) => Uri.TryCreate(source, UriKind.Absolute, out var uri) &&
        uri.Scheme == "https" && uri.Host == "leaf-reader.invalid" && uri.IsDefaultPort && uri.UserInfo.Length == 0 &&
        uri.AbsolutePath is "/" or "/index.html";

    private async void HandleMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (closing || !TrustedDocument(e.Source)) return;
        string? id = null;
        try
        {
            string raw = e.TryGetWebMessageAsString();
            if (raw.Length > 400000) return;
            using var message = JsonDocument.Parse(raw);
            id = message.RootElement.GetProperty("id").GetString();
            if (string.IsNullOrEmpty(id) || id.Length > 100 || activeRequests.Count >= 64 || !activeRequests.Add(id)) return;
            string? method = message.RootElement.GetProperty("method").GetString();
            JsonElement args = message.RootElement.GetProperty("args");
            object? result = method switch
            {
                "getSecret" => Vault.Read(),
                "setSecret" => SaveSecret(args),
                "cloudRequest" => await Network.CloudRequest(args),
                "blobTransfer" => await Network.BlobTransfer(args),
                "importConnection" => ImportConnection(),
                "updateChrome" => UpdateTheme(args.GetProperty("state")),
                _ => throw new InvalidOperationException("未知的系统请求。")
            };
            await Reply(id, result);
        }
        catch (Exception error)
        {
            if (id is not null)
                await Reply(id, null, error is HttpRequestException or TaskCanceledException ? "网络请求失败，请稍后重试。" :
                    error is InvalidOperationException ? error.Message : "系统操作失败，请重试。");
        }
        finally { if (id is not null) activeRequests.Remove(id); }
    }
    private bool SaveSecret(JsonElement args) { Vault.Save(args.GetProperty("token").GetString() ?? ""); return true; }
    private object ImportConnection()
    {
        var dialog = new OpenFileDialog { Title = "导入同步配置", Filter = "同步配置 (*.json)|*.json", Multiselect = false };
        if (dialog.ShowDialog(this) != true) throw new InvalidOperationException("已取消导入");
        if (new FileInfo(dialog.FileName).Length >= 16384) throw new InvalidOperationException("同步配置文件无效。");
        using var document = JsonDocument.Parse(File.ReadAllText(dialog.FileName));
        string endpoint = document.RootElement.GetProperty("endpoint").GetString() ?? "";
        string token = document.RootElement.GetProperty("token").GetString() ?? "";
        NetworkClient.CloudAddress(endpoint, "/v1/health");
        if (token.Length is < 32 or > 256) throw new InvalidOperationException("同步配置文件无效。");
        return new { endpoint, token };
    }
    private bool UpdateTheme(JsonElement state)
    {
        string? theme = state.GetProperty("theme").GetString();
        bool reader = state.GetProperty("mode").GetString() == "reader";
        string color = theme switch { "night" => reader ? "#242b26" : "#222725", "sepia" => reader ? "#f4ecd9" : "#f0e8d8", _ => reader ? "#f9f8f4" : "#f7f6f2" };
        Background = (SolidColorBrush)new BrushConverter().ConvertFromString(color)!;
        int dark = theme == "night" ? 1 : 0;
        DwmSetWindowAttribute(new WindowInteropHelper(this).Handle, 20, ref dark, sizeof(int));
        return true;
    }
    private async Task Reply(string id, object? result, string? error = null)
    {
        if (closing) return;
        string json = error is null ? JsonSerializer.Serialize(new { id, result }) : JsonSerializer.Serialize(new { id, error });
        try { await Browser.CoreWebView2.ExecuteScriptAsync($"window.__leafReply({json})"); }
        catch (Exception) when (closing) { }
    }
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
}
