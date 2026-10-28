import Foundation

// Only bounded binary chunks cross the web/native bridge; tokens are never sent to Blob Storage.
func blobTransfer(_ args: [String: Any], completion: @escaping ([String: Any]?, String?) -> Void) throws {
    guard let raw = args["url"] as? String, let url = URL(string: raw), url.scheme == "https", url.port == nil,
          url.user == nil, url.password == nil, url.fragment == nil,
          url.host?.hasSuffix(".blob.core.windows.net") == true,
          url.path.hasPrefix("/leaf-books/"), let method = args["method"] as? String, ["GET","PUT"].contains(method),
          URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "sig" }) == true
    else { throw NativeError.message("文件传输地址无效") }
    var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 45
    request.setValue("2023-11-03", forHTTPHeaderField: "x-ms-version")
    if method == "PUT" {
        guard let encoded = args["data"] as? String, encoded.count <= 349528, let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 262144,
              URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "comp" && $0.value == "block" }) == true
        else { throw NativeError.message("上传分块无效") }
        request.httpBody = bytes
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
    } else {
        guard let start = args["start"] as? Int, let length = args["length"] as? Int, start >= 0, start <= 104857600, length > 0, length <= 262144 else { throw NativeError.message("下载分块无效") }
        request.setValue("bytes=\(start)-\(start + length - 1)", forHTTPHeaderField: "Range")
    }
    let session = URLSession(configuration: .ephemeral, delegate: NoRedirect(), delegateQueue: nil)
    session.dataTask(with: request) { data, response, error in
        defer { session.finishTasksAndInvalidate() }
        if error != nil { completion(nil, "文件传输失败，请重试"); return }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let bytes = data ?? Data()
        guard bytes.count <= 262144 else { completion(nil, "下载分块超出大小限制"); return }
        completion(["status":status,"data":method == "GET" && status == 206 ? bytes.base64EncodedString() : ""], nil)
    }.resume()
}
