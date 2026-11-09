using System.Collections.Generic;
using System.Text.Json;

namespace Ponder.VisualStudio
{
    public sealed class AnimationRef
    {
        public AnimationRef(string id, string title) { Id = id; Title = title; }
        public string Id { get; }
        public string Title { get; }
    }

    /// <summary>
    /// Reads only what is needed to pick an animation. The page validates the whole document with the
    /// engine's validator before it renders anything.
    /// </summary>
    public sealed class PonderDocument
    {
        private readonly Dictionary<string, AnimationRef> bySymbol = new Dictionary<string, AnimationRef>();

        public string? LibraryName { get; private set; }

        public AnimationRef? Find(string symbol) => bySymbol.TryGetValue(symbol, out var a) ? a : null;

        public static PonderDocument? Parse(string text)
        {
            try
            {
                using var json = JsonDocument.Parse(text, new JsonDocumentOptions { MaxDepth = 32 });
                var root = json.RootElement;
                var doc = new PonderDocument();
                if (root.TryGetProperty("library", out var lib) && lib.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String)
                    doc.LibraryName = name.GetString();
                if (!root.TryGetProperty("animations", out var animations) || animations.ValueKind != JsonValueKind.Object) return doc;
                foreach (var a in animations.EnumerateObject())
                {
                    if (a.Value.ValueKind != JsonValueKind.Object) continue;
                    var title = a.Value.TryGetProperty("title", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString()! : a.Name;
                    var anim = new AnimationRef(a.Name, title);
                    if (a.Value.TryGetProperty("symbol", out var s) && s.ValueKind == JsonValueKind.String) doc.bySymbol[s.GetString()!] = anim;
                    if (a.Value.TryGetProperty("aliases", out var al) && al.ValueKind == JsonValueKind.Array)
                        foreach (var x in al.EnumerateArray())
                            if (x.ValueKind == JsonValueKind.String) doc.bySymbol[x.GetString()!] = anim;
                }
                return doc;
            }
            catch (JsonException)
            {
                return null;
            }
        }
    }
}
