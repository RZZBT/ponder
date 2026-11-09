using System;
using System.IO;
using System.Linq;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.FindSymbols;

namespace Ponder.VisualStudio
{
    public sealed class Outcome
    {
        public AnimationRef? Animation { get; set; }
        public string? DocumentText { get; set; }
        public string Reason { get; set; } = "";
    }

    /// <summary>
    /// C# and Visual Basic through Roslyn. The symbol is the .NET documentation comment id
    /// (<c>dotnet:M:Ns.Type.Method(System.Int32)</c>). The ponder.json is looked up next to the declaring
    /// assembly's NuGet package (<c>&lt;package&gt;/ponder.json</c>), as an embedded resource named
    /// <c>ponder.json</c>, or, for code in the solution, next to the project file.
    /// </summary>
    public static class SymbolLocator
    {
        private const int MaxBytes = 256 * 1024;

        public static async Task<string?> SymbolAtAsync(Microsoft.VisualStudio.LanguageServices.VisualStudioWorkspace workspace, string file, int position, CancellationToken ct)
        {
            var symbol = await FindAsync(workspace, file, position, ct);
            var id = symbol?.GetDocumentationCommentId();
            return id == null ? null : "dotnet:" + id;
        }

        public static async Task<Outcome> ResolveAsync(Microsoft.VisualStudio.LanguageServices.VisualStudioWorkspace workspace, string file, int position, CancellationToken ct)
        {
            var symbol = await FindAsync(workspace, file, position, ct);
            if (symbol == null) return new Outcome { Reason = "the caret is not on a method that resolves" };
            if (symbol is not IMethodSymbol) return new Outcome { Reason = "Ponder animations cover methods and constructors" };
            var id = symbol.GetDocumentationCommentId();
            if (id == null) return new Outcome { Reason = "this method has no documentation id" };
            var key = "dotnet:" + id;

            var (text, packageName, where) = LoadPonderJson(workspace, symbol);
            if (text == null) return new Outcome { Reason = where };

            var doc = PonderDocument.Parse(text);
            if (doc == null) return new Outcome { Reason = "ponder.json is not valid JSON" };
            var animation = doc.Find(key);
            if (animation == null) return new Outcome { Reason = $"no animation for {key}" };
            if (packageName != null && doc.LibraryName != null && !SameName(packageName, doc.LibraryName))
                return new Outcome { Reason = $"ponder.json declares library {doc.LibraryName}, but the package is {packageName}" };
            return new Outcome { Animation = animation, DocumentText = text };
        }

        private static async Task<ISymbol?> FindAsync(Microsoft.VisualStudio.LanguageServices.VisualStudioWorkspace workspace, string file, int position, CancellationToken ct)
        {
            var docId = workspace.CurrentSolution.GetDocumentIdsWithFilePath(file).FirstOrDefault();
            var document = docId == null ? null : workspace.CurrentSolution.GetDocument(docId);
            if (document == null) return null;
            var model = await document.GetSemanticModelAsync(ct);
            if (model == null) return null;
            var symbol = await SymbolFinder.FindSymbolAtPositionAsync(model, position, workspace, ct);
            return symbol?.OriginalDefinition;
        }

        /// <returns>The ponder.json text (or null), the package name if known, and a reason when nothing was found.</returns>
        private static (string? text, string? packageName, string where) LoadPonderJson(Microsoft.VisualStudio.LanguageServices.VisualStudioWorkspace workspace, ISymbol symbol)
        {
            var source = symbol.Locations.FirstOrDefault(l => l.IsInSource)?.SourceTree?.FilePath;
            if (source != null)
            {
                // code in the solution: the folder of the nearest project file
                for (var dir = Path.GetDirectoryName(source); dir != null; dir = Path.GetDirectoryName(dir))
                {
                    if (!Directory.EnumerateFiles(dir, "*.??proj").Any()) continue;
                    var f = Path.Combine(dir, "ponder.json");
                    return File.Exists(f) ? (ReadLimited(f), null, "") : (null, null, $"{Path.GetFileName(dir)} has no ponder.json");
                }
                return (null, null, "the method is not in a project");
            }

            var assembly = symbol.ContainingAssembly;
            var dll = workspace.CurrentSolution.Projects
                .Select(p => p.MetadataReferences.OfType<PortableExecutableReference>()
                    .FirstOrDefault(r => r.FilePath != null && string.Equals(Path.GetFileNameWithoutExtension(r.FilePath), assembly.Identity.Name, StringComparison.OrdinalIgnoreCase)))
                .FirstOrDefault(r => r != null)?.FilePath;
            if (dll == null) return (null, null, $"cannot find the file of assembly {assembly.Identity.Name}");

            // NuGet layout: <packages>/<id>/<version>/lib/<tfm>/X.dll with <id>.nuspec in <version>
            for (var dir = Path.GetDirectoryName(dll); dir != null; dir = Path.GetDirectoryName(dir))
            {
                var nuspec = Directory.EnumerateFiles(dir, "*.nuspec").FirstOrDefault();
                if (nuspec == null) continue;
                var id = NuspecId(nuspec);
                var f = Path.Combine(dir, "ponder.json");
                if (File.Exists(f)) return (ReadLimited(f), id, "");
                break;
            }
            var embedded = EmbeddedPonderJson(dll);
            return embedded != null ? (embedded, null, "") : (null, null, $"{assembly.Identity.Name} has no ponder.json");
        }

        private static string? ReadLimited(string path) =>
            new FileInfo(path).Length <= MaxBytes ? File.ReadAllText(path) : null;

        private static string? NuspecId(string nuspec)
        {
            try { return XDocument.Load(nuspec).Descendants().FirstOrDefault(e => e.Name.LocalName == "id")?.Value; }
            catch { return null; }
        }

        private static string? EmbeddedPonderJson(string dll)
        {
            try
            {
                using var stream = File.OpenRead(dll);
                using var pe = new PEReader(stream);
                var md = pe.GetMetadataReader();
                foreach (var h in md.ManifestResources)
                {
                    var res = md.GetManifestResource(h);
                    if (!res.Implementation.IsNil || !md.GetString(res.Name).EndsWith("ponder.json", StringComparison.OrdinalIgnoreCase)) continue;
                    var dir = pe.PEHeaders.CorHeader!.ResourcesDirectory;
                    var data = pe.GetSectionData(dir.RelativeVirtualAddress).GetReader();
                    data.Offset = (int)res.Offset;
                    var length = data.ReadInt32();
                    if (length > MaxBytes) return null;
                    return System.Text.Encoding.UTF8.GetString(data.ReadBytes(length));
                }
            }
            catch (Exception) { }
            return null;
        }

        private static bool SameName(string a, string b) => Normalize(a) == Normalize(b);
        private static string Normalize(string s) => System.Text.RegularExpressions.Regex.Replace(s.ToLowerInvariant(), "[-_.]+", "-");
    }
}
