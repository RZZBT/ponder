// Turns language-server outline names into the plain name path used in symbols: ["IntStack", "push"].

export interface OutlineNode {
  name: string;
  /** Range of the whole declaration. */
  range: { contains(p: unknown): boolean };
  /** Range of the declared name. */
  selectionRange: { contains(p: unknown): boolean };
  children: OutlineNode[];
}

/** Path of nodes from the outermost symbol down to the one declared at [pos]. */
export function nodePathAt(nodes: OutlineNode[], pos: unknown): OutlineNode[] {
  for (const n of nodes) {
    if (!n.range.contains(pos)) continue;
    const inner = nodePathAt(n.children, pos);
    if (inner.length > 0) return [n, ...inner];
    if (n.selectionRange.contains(pos) || n.range.contains(pos)) return [n];
  }
  return [];
}

/**
 * One outline name to name parts. Servers decorate names differently:
 * `clamp(int, int, int) : int` (Java), `(*IntStack).Push` (Go), `impl Display for IntStack` (Rust),
 * `IntStack::push` (C++ out-of-line definitions), `List<T>` (generics).
 */
export function cleanName(raw: string): string[] {
  let s = raw.trim();
  const go = /^\(\*?([A-Za-z_]\w*)(?:\[[^\]]*\])?\)\.([A-Za-z_]\w*)/.exec(s);
  if (go) return [go[1]!, go[2]!];
  const impl = /^impl(?:<[^>]*>)?\s+(?:.+\s+for\s+)?([A-Za-z_][\w:]*)/.exec(s);
  if (impl) s = impl[1]!;
  // `impl<T> [T]`, `impl<T, const N: usize> [T; N]`, `impl<T> *const T`: the type has no name, so the block adds
  // none (Rust's slice methods are `rust:core::slice::windows`), as in the JetBrains plugin and the index tools
  else if (/^impl\b/.test(s)) return [];
  s = s.replace(/\(.*$/s, '').replace(/<[^>]*>/g, '').replace(/\s+:\s.*$/s, '').trim();
  if (!s) return [];
  return s.split(/::|:/).filter((p) => p.length > 0).map((p) => p.trim()); // Lua methods: IntStack:push
}

/** Parameter types from a Java-style outline name: `clamp(int, int, int) : int` gives ["int", "int", "int"]. */
export function outlineParams(raw: string): string[] | null {
  const m = /\(([^)]*)\)/.exec(raw);
  if (!m) return null;
  const inner = m[1]!.trim();
  if (!inner) return [];
  return inner.split(',').map((p) => p.trim().replace(/<[^>]*>/g, '').replace(/\.\.\.$/, '[]').split(/\s+/)[0]!);
}

export function namesFor(path: OutlineNode[]): string[] {
  return path.flatMap((n) => cleanName(n.name));
}
