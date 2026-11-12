// Finds the animation for a set of candidate symbols in one ponder.json.
import { parseDocument } from '../../engine/src/parser/validate';
import { normalizeSymbol, parseSymbol } from '../../engine/src/parser/symbol';
import type { Issue } from '../../engine/src/scene/model';

export interface AnimationRef { id: string; title: string; symbol: string }

export interface LoadedDocument {
  ok: boolean;
  errors: Issue[];
  /** The file is meant for a newer Ponder. */
  needsUpdate?: boolean;
  library?: { group?: string; name: string };
  find(candidates: string[], looseJvm?: boolean): AnimationRef | null;
}

/** `com.example.MathUtils#clamp(java.lang.String,int)` to `com.example.MathUtils#clamp(String,int)`. */
export function looseJvm(symbol: string): string | null {
  const { scheme, body } = parseSymbol(symbol);
  if (scheme !== 'jvm') return null;
  const m = /^(.*)\((.*)\)$/.exec(body);
  if (!m) return null;
  const params = m[2] ? m[2].split(',').map((t) => t.slice(t.lastIndexOf('.') + 1)) : [];
  return `${m[1]}(${params.join(',')})`;
}

export function loadDocument(text: string): LoadedDocument {
  const result = parseDocument(text);
  const doc = result.document;
  if (!result.ok || !doc) return { ok: false, errors: result.errors, needsUpdate: result.needsUpdate === true, find: () => null };

  const exact = new Map<string, AnimationRef>();
  const loose = new Map<string, AnimationRef[]>();
  const cppNoParams = new Map<string, AnimationRef[]>();
  for (const [id, a] of Object.entries(doc.animations)) {
    const ref = { id, title: a.title, symbol: a.symbol };
    for (const s of [a.symbol, ...(a.aliases ?? [])]) {
      exact.set(normalizeSymbol(s), ref);
      const l = looseJvm(s);
      if (l) loose.set(l, [...(loose.get(l) ?? []), ref]);
      if (s.startsWith('cpp:') && s.endsWith(')')) {
        const k = s.slice(0, s.indexOf('('));
        cppNoParams.set(k, [...(cppNoParams.get(k) ?? []), ref]);
      }
    }
  }
  const unique = (refs: AnimationRef[] | undefined) => (refs && new Set(refs).size === 1 ? refs[0]! : null);

  return {
    ok: true,
    errors: [],
    library: doc.library,
    find(candidates, looseJvmMatch = false) {
      for (const c of candidates) {
        const hit = exact.get(normalizeSymbol(c));
        if (hit) return hit;
      }
      for (const c of candidates) {
        if (looseJvmMatch) {
          const l = looseJvm(c);
          const hit = l ? unique(loose.get(l)) : null;
          if (hit) return hit;
        }
        if (c.startsWith('cpp:') && !c.endsWith(')') && !exact.has(c)) {
          const hit = unique(cppNoParams.get(c));
          if (hit) return hit;
        }
      }
      return null;
    },
  };
}
