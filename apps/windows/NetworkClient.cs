using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace LeafReader;

internal sealed class NetworkClient : IDisposable
{
    private readonly HttpClient client = new(new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false }) { Timeout = TimeSpan.FromSeconds(45) };
    internal const int ChunkSize = 262144;
    internal static Uri CloudAddress(string endpoint, string path)
    {
        if (!Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) || uri.UserInfo.Length > 0 || uri.Query.Length > 0 || uri.Fragment.Length > 0 ||
            !(uri.Scheme == "https" || uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == 7071) ||
            !Regex.IsMatch(uri.AbsolutePath, "^/[A-Za-z0-9/_-]*$") || !Regex.IsMatch(path, "^/v1/[A-Za-z0-9/_-]+$"))
            throw new InvalidOperationException("同步地址或请求无效。");
        return new Uri(endpoint.TrimEnd('/') + path);
    }
    internal static Uri BlobAddress(string address, string method)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var uri) || uri.Scheme != "https" || !uri.IsDefaultPort || uri.UserInfo.Length > 0 || uri.Fragment.Length > 0 ||
            !Regex.IsMatch(uri.Host, "^[a-z0-9]+\\.blob\\.core\\.windows\\.net$") || !Regex.IsMatch(uri.AbsolutePath, "^/leaf-books/[A-Za-z0-9/_-]+$") ||
            uri.Query.Length > 8192 || !QueryHas(uri, "sig") || method is not ("GET" or "PUT") || method == "PUT" && !QueryHas(uri, "comp", "block"))
            throw new InvalidOperationException("文件传输地址无效。");
        return uri;
    }
    private static bool QueryHas(Uri uri, string key, string? value = null) => uri.Query.TrimStart('?').Split('&').Select(part => part.Split('=', 2))
        .Any(pair => pair.Length == 2 && pair[0] == key && pair[1].Length > 0 && (value is null || Uri.UnescapeDataString(pair[1]) == value));

    internal async Task<object> CloudRequest(JsonElement args)
    {
        string method = args.GetProperty("method").GetString() ?? "";
        if (method is not ("GET" or "PUT" or "DELETE")) throw new InvalidOperationException("同步请求无效。");
        var uri = CloudAddress(args.GetProperty("endpoint").GetString() ?? "", args.GetProperty("path").GetString() ?? "");
        using var request = new HttpRequestMessage(new HttpMethod(method), uri);
        string token = args.GetProperty("token").GetString() ?? "";
        if (!Regex.IsMatch(token, "^[A-Za-z0-9_-]{32,256}$")) throw new InvalidOperationException("连接码无效。");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        if (method == "PUT")
        {
            string body = args.GetProperty("body").GetRawText();
            if (Encoding.UTF8.GetByteCount(body) > 8192) throw new InvalidOperationException("同步请求过大。");
            request.Content = new StringContent(body, Encoding.UTF8, "application/json");
        }
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        byte[] bytes = await ReadBounded(response.Content, 2 * 1024 * 1024);
        try
        {
            using var json = JsonDocument.Parse(bytes);
            return new { status = (int)response.StatusCode, data = json.RootElement.Clone() };
        }
        catch (JsonException) { throw new InvalidOperationException("同步服务返回了无法识别的数据。"); }
    }

    internal async Task<object> BlobTransfer(JsonElement args)
    {
        string method = args.GetProperty("method").GetString() ?? "";
        var uri = BlobAddress(args.GetProperty("url").GetString() ?? "", method);
        using var request = new HttpRequestMessage(new HttpMethod(method), uri);
        request.Headers.Add("x-ms-version", "2023-11-03");
        if (method == "PUT")
        {
            string encoded = args.GetProperty("data").GetString() ?? "";
            if (encoded.Length > 349528) throw new InvalidOperationException("上传分块过大。");
            byte[] bytes = Convert.FromBase64String(encoded);
            if (bytes.Length is < 1 or > ChunkSize) throw new InvalidOperationException("上传分块无效。");
            request.Content = new ByteArrayContent(bytes);
            request.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        }
        else
        {
            int start = args.GetProperty("start").GetInt32(), length = args.GetProperty("length").GetInt32();
            if (start < 0 || length is < 1 or > ChunkSize || (long)start + length > 100 * 1024 * 1024) throw new InvalidOperationException("下载分块无效。");
            request.Headers.Range = new RangeHeaderValue(start, start + length - 1);
        }
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        byte[] result = await ReadBounded(response.Content, ChunkSize);
        return new { status = (int)response.StatusCode, data = method == "GET" && response.StatusCode == HttpStatusCode.PartialContent ? Convert.ToBase64String(result) : "" };
    }

    private static async Task<byte[]> ReadBounded(HttpContent content, int maximum)
    {
        if (content.Headers.ContentLength > maximum) throw new InvalidOperationException("服务返回的数据过大。");
        using Stream source = await content.ReadAsStreamAsync();
        using var target = new MemoryStream();
        byte[] buffer = new byte[16384];
        int read;
        while ((read = await source.ReadAsync(buffer)) > 0)
        {
            if (target.Length + read > maximum) throw new InvalidOperationException("服务返回的数据过大。");
            target.Write(buffer, 0, read);
        }
        return target.ToArray();
    }
    public void Dispose() => client.Dispose();
}
