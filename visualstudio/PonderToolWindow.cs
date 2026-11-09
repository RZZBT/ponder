using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Ponder.VisualStudio
{
    [Guid("b6a91f2e-3d54-4c8b-a7e0-9f13c5d2e486")]
    public sealed class PonderToolWindow : ToolWindowPane
    {
        private const string Host = "ponder.invalid";
        private readonly WebView2 view = new WebView2();
        private (string text, string id)? pending;
        private bool ready;

        public PonderToolWindow() : base(null)
        {
            Caption = "Ponder";
            Content = new Grid { Children = { view } };
        }

        public async Task ShowAsync(string documentText, string animationId)
        {
            pending = (documentText, animationId);
            if (view.CoreWebView2 == null) await InitializeAsync();
            Send();
        }

        private async Task InitializeAsync()
        {
            var dataDir = Path.Combine(Path.GetTempPath(), "ponder-webview2");
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await view.EnsureCoreWebView2Async(env);
            var core = view.CoreWebView2;
            var media = Path.Combine(Path.GetDirectoryName(typeof(PonderToolWindow).Assembly.Location)!, "media");
            core.SetVirtualHostNameToFolderMapping(Host, media, CoreWebView2HostResourceAccessKind.Deny);
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.NewWindowRequested += (s, e) => e.Handled = true;
            core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith($"https://{Host}/", StringComparison.Ordinal)) e.Cancel = true; };
            core.WebMessageReceived += OnMessage;
            core.Navigate($"https://{Host}/index.html");
        }

        private void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string? raw;
            try { raw = e.TryGetWebMessageAsString(); } catch (ArgumentException) { return; }
            if (raw == null || raw.Length > 2000) return;
            string? type = null;
            try { using var json = JsonDocument.Parse(raw); type = json.RootElement.GetProperty("type").GetString(); }
            catch (Exception) { return; }
            if (type == "loaded") { ready = true; Send(); } // the engine's own "ready" needs no answer
            else if (type == "close") ThreadHelper.JoinableTaskFactory.Run(async () =>
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                ((Microsoft.VisualStudio.Shell.Interop.IVsWindowFrame)Frame).Hide();
            });
        }

        private void Send()
        {
            if (!ready || pending == null || view.CoreWebView2 == null) return;
            var message = JsonSerializer.Serialize(new { type = "start", text = pending.Value.text, id = pending.Value.id, theme = IsDark() ? "dark" : "light" });
            view.CoreWebView2.PostWebMessageAsJson(message);
        }

        private static bool IsDark()
        {
            var bg = Microsoft.VisualStudio.PlatformUI.VSColorTheme.GetThemedColor(Microsoft.VisualStudio.PlatformUI.EnvironmentColors.ToolWindowBackgroundColorKey);
            return (bg.R * 299 + bg.G * 587 + bg.B * 114) / 1000 < 128;
        }
    }
}
