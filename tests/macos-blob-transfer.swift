import Foundation

enum NativeError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}
final class NoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
let input = FileHandle.standardInput.readDataToEndOfFile()
let semaphore = DispatchSemaphore(value: 0)
do {
    let args = try JSONSerialization.jsonObject(with: input) as! [String: Any]
    try blobTransfer(args) { result, error in
        let output: [String: Any] = error.map { ["error":$0] } ?? result ?? [:]
        if let data = try? JSONSerialization.data(withJSONObject: output) { FileHandle.standardOutput.write(data) }
        semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 55) == .timedOut { exit(2) }
} catch { print("Native binary transfer failed"); exit(1) }
