// Symbol strings. A prefix names the scheme; no prefix means JVM. Mirrored in PonderSymbols.kt and the schema.

const JVM_TYPE = String.raw`(?:boolean|byte|char|short|int|long|float|double|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?:\[\])*`;
const JVM = String.raw`[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*#(?:<init>|[A-Za-z_$][\w$]*)\((?:${JVM_TYPE}(?:,${JVM_TYPE})*)?\)`;

export const SYMBOL_SCHEMES = {
  /** `com.example.MathUtils#clamp(int,int,int)`, constructors `#<init>(...)` */
  jvm: JVM,
  /** `mathutils.core.clamp`, `mathutils.stack.IntStack.push` */
  py: String.raw`[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*`,
  /** `math-utils#clamp`, `@acme/math/stack#IntStack.push`, `pkg#default` */
  js: String.raw`(?:@[\w.-]+\/)?[\w.-]+(?:\/[\w.-]+)*#[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*`,
  /** .NET documentation comment id: `M:MathUtils.Clamp(System.Int32,System.Int32,System.Int32)`, `M:Ns.T.#ctor` */
  dotnet: String.raw`[MTPFE]:[\w.#\x60{}@*\[\],]+(?:\([\w.#\x60{}@*\[\],]*\))?`,
  /** `example.com/mathutils.Clamp`, `example.com/mathutils.IntStack.Push` */
  go: String.raw`[\w.~-]+(?:\/[\w.~-]+)*\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?`,
  /** `math_utils::clamp`, `math_utils::stack::IntStack::push` */
  rust: String.raw`[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+`,
  /** `math::clamp(int,int,int)`, `math::IntStack::push(int)` */
  cpp: String.raw`[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*)*(?:\([\w:,*&<> ]*\))?`,
  /** Any language: file path relative to the ponder.json folder, then the outline path. `src/stack.rb:IntStack.push` */
  sym: String.raw`[\w.-]+(?:\/[\w.-]+)*:[^\s:]+`,
} as const;

export type SymbolScheme = keyof typeof SYMBOL_SCHEMES;

const SCHEME_RES = Object.fromEntries(
  Object.entries(SYMBOL_SCHEMES).map(([k, v]) => [k, new RegExp(`^${v}$`)]),
) as Record<SymbolScheme, RegExp>;

/** Splits `py:a.b` into `['py', 'a.b']`. Without a known prefix the symbol is JVM. */
export function parseSymbol(s: string): { scheme: SymbolScheme; body: string } {
  const m = /^([a-z]+):(?!:)/.exec(s);
  const prefix = m?.[1];
  if (m && prefix && prefix in SYMBOL_SCHEMES) return { scheme: prefix as SymbolScheme, body: s.slice(m[0].length) };
  return { scheme: 'jvm', body: s };
}

export function isValidSymbolSyntax(s: string): boolean {
  const { scheme, body } = parseSymbol(s);
  if (scheme === 'sym' && body.split(':')[0]!.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  return SCHEME_RES[scheme].test(body);
}

/** One regex for the JSON schema. */
export function symbolSchemaPattern(): string {
  const alts = Object.entries(SYMBOL_SCHEMES).map(([k, v]) => (k === 'jvm' ? `(jvm:)?${v}` : `${k}:${v}`));
  return `^(${alts.join('|')})$`;
}

/** `jvm:a.B#m()` and `a.B#m()` are the same symbol. */
export function normalizeSymbol(s: string): string {
  const p = parseSymbol(s);
  return p.scheme === 'jvm' ? p.body : s;
}
