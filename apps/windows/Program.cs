using System.IO;
using System.Text.Json;
using System.Windows;

namespace LeafReader;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool smoke = args.Contains("--smoke-test");
        using var singleInstance = new Mutex(true, smoke ? "Local\\LeafReader.Smoke." + Guid.NewGuid().ToString("N") : "Local\\LeafReader.Desktop", out bool first);
        if (!first) { MessageBox.Show("页间已在运行，请切换到已有窗口。", "页间"); return 0; }
        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        string dataDirectory = smoke ? Path.Combine(Path.GetTempPath(), "leaf-reader-smoke-" + Guid.NewGuid().ToString("N")) :
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LeafReader");
        Directory.CreateDirectory(dataDirectory);
        var window = new ReaderWindow(dataDirectory, smoke, args);
        app.Run(window);
        if (smoke)
        {
            try { Directory.Delete(dataDirectory, true); } catch (IOException) { /* WebView runtime may still be releasing temporary files. */ }
        }
        return window.ExitCode;
    }
}
