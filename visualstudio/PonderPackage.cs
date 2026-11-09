using System;
using System.ComponentModel.Design;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows;
using Microsoft.VisualStudio.ComponentModelHost;
using Microsoft.VisualStudio.Editor;
using Microsoft.VisualStudio.LanguageServices;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.TextManager.Interop;
using Task = System.Threading.Tasks.Task;

namespace Ponder.VisualStudio
{
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [Guid("3c0a8e55-6f0b-4b0e-9c41-2f1a6d7b8e10")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideToolWindow(typeof(PonderToolWindow), Style = VsDockStyle.Float, Width = 680, Height = 500, Transient = true)]
    public sealed class PonderPackage : AsyncPackage
    {
        private static readonly Guid CommandSet = new Guid("8f5c2d34-1e7a-4c69-b0d2-5a9e3f1c4b77");
        private const int CmdOpenPonder = 0x0100;
        private const int CmdCopySymbol = 0x0101;

        private VisualStudioWorkspace? workspace;

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
            var models = (IComponentModel)await GetServiceAsync(typeof(SComponentModel));
            workspace = models.GetService<VisualStudioWorkspace>();

            var commands = (OleMenuCommandService)await GetServiceAsync(typeof(IMenuCommandService));
            commands.AddCommand(new OleMenuCommand((s, e) => JoinableTaskFactory.RunAsync(OpenAsync).FileAndForget("ponder/open"),
                new CommandID(CommandSet, CmdOpenPonder)));
            commands.AddCommand(new OleMenuCommand((s, e) => JoinableTaskFactory.RunAsync(CopySymbolAsync).FileAndForget("ponder/copy"),
                new CommandID(CommandSet, CmdCopySymbol)));
        }

        private async Task OpenAsync()
        {
            var caret = await CaretAsync();
            if (caret == null || workspace == null) return;
            var outcome = await SymbolLocator.ResolveAsync(workspace, caret.Value.file, caret.Value.position, DisposalToken);

            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            if (outcome.Animation == null)
            {
                await StatusAsync($"No Ponder animation: {outcome.Reason}");
                return;
            }
            var window = (PonderToolWindow)await ShowToolWindowAsync(typeof(PonderToolWindow), 0, true, DisposalToken);
            window.Caption = $"Ponder: {outcome.Animation.Title}";
            await window.ShowAsync(outcome.DocumentText!, outcome.Animation.Id);
        }

        private async Task CopySymbolAsync()
        {
            var caret = await CaretAsync();
            if (caret == null || workspace == null) return;
            var symbol = await SymbolLocator.SymbolAtAsync(workspace, caret.Value.file, caret.Value.position, DisposalToken);
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            if (symbol == null)
            {
                await StatusAsync("Put the caret on a method name.");
                return;
            }
            Clipboard.SetText(symbol);
            await StatusAsync($"Copied: {symbol}");
        }

        private async System.Threading.Tasks.Task<(string file, int position)?> CaretAsync()
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            var textManager = (IVsTextManager)await GetServiceAsync(typeof(SVsTextManager));
            if (textManager.GetActiveView(1, null, out var view) != 0 || view == null) return null;
            var models = (IComponentModel)await GetServiceAsync(typeof(SComponentModel));
            var wpfView = models.GetService<IVsEditorAdaptersFactoryService>().GetWpfTextView(view);
            if (wpfView == null) return null;
            if (!wpfView.TextBuffer.Properties.TryGetProperty(typeof(Microsoft.VisualStudio.Text.ITextDocument), out Microsoft.VisualStudio.Text.ITextDocument doc)) return null;
            return (doc.FilePath, wpfView.Caret.Position.BufferPosition.Position);
        }

        private async Task StatusAsync(string text)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(DisposalToken);
            var bar = (IVsStatusbar)await GetServiceAsync(typeof(SVsStatusbar));
            bar.SetText(text);
        }
    }
}
