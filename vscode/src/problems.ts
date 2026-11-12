// Everything that can stop Ponder from showing an animation, in words a beginner can act on. Each problem says what
// happened, why, and what to try, with buttons for the steps VS Code can do itself. No vscode import: unit-tested.
// The JetBrains plugin has the same catalogue in PonderProblems.kt; keep the wording close.

export type ProblemId =
  | 'no-name' | 'restricted-mode' | 'no-language-extension' | 'language-support-off' | 'not-in-project'
  | 'library-not-installed' | 'no-definition' | 'unsupported-declaration' | 'ambiguous'
  | 'own-code' | 'unknown-library' | 'no-animation-yet' | 'online-off' | 'online-skipped'
  | 'index-unreachable' | 'broken-library-file' | 'needs-update' | 'unexpected';

/** A button. [command] is a VS Code command id; [args] are passed to it. */
export interface ProblemAction { label: string; command: string; args?: unknown[] }

export interface Problem {
  id: ProblemId;
  /** One line, no final period: "Rust support isn't installed". */
  title: string;
  /** What happened and why, one to three sentences. */
  detail: string;
  /** What to try, most likely fix first. */
  tries: string[];
  actions: ProblemAction[];
  /** Something on this computer stops Ponder (shown as a warning), rather than "nothing written yet". */
  setup: boolean;
}

const p = (id: ProblemId, title: string, detail: string, tries: string[], actions: ProblemAction[] = [], setup = false): Problem =>
  ({ id, title, detail, tries, actions, setup });

// ------------------------------------------------------------------ language support

/** The extension that gives VS Code "Go to Definition" for a language, which Ponder relies on. */
export interface LanguageSupport { language: string; recommended: { id: string; name: string }; acceptable: string[] }

const SUPPORT: Record<string, LanguageSupport> = {
  python: { language: 'Python', recommended: { id: 'ms-python.python', name: 'Python' }, acceptable: ['ms-python.python', 'ms-python.vscode-pylance', 'detachhead.basedpyright', 'ms-pyright.pyright'] },
  rust: { language: 'Rust', recommended: { id: 'rust-lang.rust-analyzer', name: 'rust-analyzer' }, acceptable: ['rust-lang.rust-analyzer'] },
  go: { language: 'Go', recommended: { id: 'golang.go', name: 'Go' }, acceptable: ['golang.go'] },
  java: { language: 'Java', recommended: { id: 'vscjava.vscode-java-pack', name: 'Extension Pack for Java' }, acceptable: ['redhat.java'] },
  c: { language: 'C', recommended: { id: 'ms-vscode.cpptools', name: 'C/C++' }, acceptable: ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'] },
  cpp: { language: 'C++', recommended: { id: 'ms-vscode.cpptools', name: 'C/C++' }, acceptable: ['ms-vscode.cpptools', 'llvm-vs-code-extensions.vscode-clangd'] },
  csharp: { language: 'C#', recommended: { id: 'ms-dotnettools.csharp', name: 'C#' }, acceptable: ['ms-dotnettools.csharp', 'ms-dotnettools.csdevkit'] },
  php: { language: 'PHP', recommended: { id: 'bmewburn.vscode-intelephense-client', name: 'PHP Intelephense' }, acceptable: ['bmewburn.vscode-intelephense-client', 'devsense.phptools-vscode', 'xdebug.php-pack'] },
  ruby: { language: 'Ruby', recommended: { id: 'shopify.ruby-lsp', name: 'Ruby LSP' }, acceptable: ['shopify.ruby-lsp'] },
  lua: { language: 'Lua', recommended: { id: 'sumneko.lua', name: 'Lua' }, acceptable: ['sumneko.lua'] },
};

export function languageSupport(languageId: string): LanguageSupport | null {
  return SUPPORT[languageId] ?? null;
}

const LANGUAGE_NAMES: Record<string, string> = {
  javascript: 'JavaScript', typescript: 'TypeScript', javascriptreact: 'JavaScript', typescriptreact: 'TypeScript',
};
export const languageName = (languageId: string) => SUPPORT[languageId]?.language ?? LANGUAGE_NAMES[languageId] ?? languageId;

/** The project file a language needs around a source file before its extension can see libraries. */
export const PROJECT_FILES: Record<string, { file: string; create: string }> = {
  rust: { file: 'Cargo.toml', create: 'cargo new my_project' },
  go: { file: 'go.mod', create: 'go mod init example.com/my_project' },
};

/** How to install a library, per language. */
function installCommand(languageId: string, module: string): string | null {
  switch (languageId) {
    case 'python': return `python -m pip install ${module}`;
    case 'javascript': case 'typescript': case 'javascriptreact': case 'typescriptreact': return `npm install ${module}`;
    case 'rust': return `cargo add ${module.replace(/_/g, '-')}`;
    case 'go': return `go get ${module}`;
    default: return null;
  }
}

/**
 * Library names from diagnostics that say an import cannot be found: Pylance, TypeScript, rust-analyzer/rustc,
 * gopls. Returns the first module named, or null.
 */
export function unresolvedImport(diagnostics: { message: string; code?: unknown }[]): string | null {
  const firstDotted = (m: string) => m.split('.')[0]!;
  const npmPackage = (m: string) => (m.startsWith('@') ? m.split('/').slice(0, 2).join('/') : m.split('/')[0]!);
  const patterns: [RegExp, (m: string) => string][] = [
    [/Import "([\w.]+)" could not be resolved/, firstDotted], // Pylance (reportMissingImports)
    [/No module named '([\w.]+)'/, firstDotted], // Python runtime-style messages
    [/Cannot find module '([^']+)'/, npmPackage], // TypeScript 2307
    [/unresolved import `([\w:]+)`/, (m) => m.split('::')[0]!], // rust-analyzer, rustc E0432
    [/use of undeclared crate or module `(\w+)`/, (m) => m], // rustc E0433
    [/could not import ([\w./-]+)/, (m) => m], // gopls: the full import path
    [/no required module provides package ([\w./-]+)/, (m) => m], // go
  ];
  for (const d of diagnostics) {
    for (const [re, trim] of patterns) {
      const m = re.exec(d.message);
      if (m && !m[1]!.startsWith('.')) return trim(m[1]!); // relative imports are the user's own files
    }
  }
  return null;
}

export const BUILT_IN_JS = { id: 'vscode.typescript-language-features', languages: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'] };

// ------------------------------------------------------------------ before a definition is known

export const problems = {
  noName: (): Problem => p('no-name',
    'Put the cursor on a function name',
    'Ponder explains functions and methods. The cursor is on a space, a keyword or something that is not a name.',
    [
      'Click inside a function name, for example on `sorted` in `sorted(numbers)` or on `clip` in `np.clip(a, 0, 1)`.',
      'Then press Alt+W again, or right-click the name and choose "Open Ponder".',
    ]),

  restrictedMode: (): Problem => p('restricted-mode',
    'This folder is open in Restricted Mode',
    'VS Code turns off language support in folders you have not trusted yet, so it cannot tell Ponder where a function is defined.',
    [
      'Click "Trust Folder…" below and choose "Yes, I trust the authors" if this is your code or code you trust.',
      'Not sure? Open only folders you trust, or keep working without Ponder in this one.',
    ],
    [{ label: 'Trust Folder…', command: 'workbench.trust.manage' }], true),

  noLanguageExtension: (languageId: string, support: LanguageSupport): Problem => p('no-language-extension',
    `${support.language} support isn't installed`,
    `Ponder asks VS Code where a function is defined. For ${support.language} files that needs the "${support.recommended.name}" extension, which is not installed.`,
    [
      `Click "Install ${support.recommended.name}" below (it is free, by ${support.recommended.id.split('.')[0]}).`,
      'Wait until it has finished loading (watch the status bar), then press Alt+W again.',
    ],
    [{ label: `Install ${support.recommended.name}`, command: 'workbench.extensions.installExtension', args: [support.recommended.id] }], true),

  languageSupportOff: (languageId: string): Problem => p('language-support-off',
    `${languageName(languageId)} support is turned off`,
    `VS Code's built-in "TypeScript and JavaScript Language Features" extension is disabled, so it cannot tell Ponder where ${languageName(languageId)} functions are defined.`,
    [
      'Click "Show built-in extension" below and choose Enable.',
      'Then reload the window if VS Code asks, and press Alt+W again.',
    ],
    [{ label: 'Show built-in extension', command: 'workbench.extensions.search', args: ['@builtin typescript'] }], true),

  notInProject: (languageId: string): Problem => {
    const proj = PROJECT_FILES[languageId]!;
    const lang = languageName(languageId);
    return p('not-in-project',
      `This file is not part of a ${lang} project`,
      `${lang} tools only know about libraries inside a project, and no ${proj.file} was found next to this file or above it.`,
      [
        `Open the folder that contains ${proj.file} (File → Open Folder…), then open this file from there.`,
        `No project yet? Create one in the terminal with \`${proj.create}\` and put your code in it.`,
        'Then press Alt+W again.',
      ],
      [{ label: 'Open Folder…', command: 'workbench.action.files.openFolder' }], true);
  },

  libraryNotInstalled: (languageId: string, module: string): Problem => {
    const cmd = installCommand(languageId, module);
    const tries = cmd
      ? [`Install it: open a terminal (Terminal → New Terminal) and run \`${cmd}\`.`]
      : [`Install "${module}" with your language's package manager.`];
    if (languageId === 'python') {
      tries.push('Installed already? Make sure VS Code uses the same Python: click "Select Python interpreter" below.');
      tries.push('The install name can differ from the import name (for example `import sklearn` is `pip install scikit-learn`).');
    }
    tries.push('When the red underline under the import is gone, press Alt+W again.');
    const actions: ProblemAction[] = [{ label: 'Open Terminal', command: 'workbench.action.terminal.new' }];
    if (languageId === 'python') actions.push({ label: 'Select Python interpreter', command: 'python.setInterpreter' });
    return p('library-not-installed',
      `"${module}" isn't installed`,
      `This file uses "${module}", but VS Code cannot find it, so it cannot tell Ponder where its functions are defined.`,
      tries, actions, true);
  },

  noDefinition: (languageId: string, name: string): Problem => {
    const tries = [
      'Wait a few seconds: language support may still be loading this project (watch the status bar), then try again.',
      `Check with Go to Definition (F12) on \`${name}\`. If VS Code cannot find it either, fix that first; the import may be missing or misspelled.`,
    ];
    if (languageId === 'python') tries.push('Using a virtual environment? Choose it with "Select Python interpreter".');
    const actions: ProblemAction[] = languageId === 'python' ? [{ label: 'Select Python interpreter', command: 'python.setInterpreter' }] : [];
    return p('no-definition',
      `VS Code can't find where "${name}" is defined`,
      'Ponder needs the definition to know which library a function belongs to.',
      tries, actions, true);
  },

  unsupportedDeclaration: (why: string): Problem => p('unsupported-declaration',
    'Ponder cannot read this definition',
    `${capitalize(why)}.`,
    [
      'Ponder explains functions, methods and constructors that come from files on this computer.',
      'Try Alt+W on a call of a function from a library or from the language itself.',
    ]),

  ambiguous: (name: string): Problem => p('ambiguous',
    `"${name}" points to more than one function`,
    'The language extension reports several different definitions here, so Ponder cannot tell which animation to show.',
    [
      'Put the cursor on a more specific call, for example `module.function(...)` instead of an imported alias.',
      'Or open the definition with F12 and press Alt+W on the call you meant.',
    ]),

  // ---------------------------------------------------------------- after the definition is known

  ownCode: (name: string): Problem => p('own-code',
    `"${name}" is your own code`,
    'Ponder explains functions of libraries and of the language itself. This one is defined in your project.',
    [
      'Try Alt+W on a library or built-in call, for example `sorted(...)`, `"a,b".split(",")` or `np.clip(...)`.',
      'Writing a library? You can add animations for your own functions: right-click a function → "Copy Ponder Symbol", then see the guide "Create an animation".',
    ]),

  unknownLibrary: (name: string, library: string): Problem => p('unknown-library',
    `No animation for "${name}"`,
    `"${library}" has no ponder.json of its own, and Ponder cannot tell its name and version for sure, so it cannot look it up anywhere else.`,
    [
      'Try another function: libraries installed with a package manager (pip, npm, cargo, go) are recognised best.',
      'Is this your library? Add a ponder.json next to its package.json / pyproject.toml / Cargo.toml.',
    ]),

  noAnimationYet: (name: string, where: string): Problem => p('no-animation-yet',
    `No animation for "${name}" yet`,
    `Nobody has written a Ponder animation for ${name} in ${where} so far.`,
    [
      'Try another function: popular ones are being added to the community index all the time.',
      'Know this function well? Write an animation for it in a `.ponder` folder in your project; Ponder uses it right away.',
      'Is this your library? Ship a ponder.json with it and every user gets the animation.',
    ]),

  onlineOff: (name: string, where: string): Problem => p('online-off',
    `No animation for "${name}" on this computer`,
    `${capitalize(where)} has no animation of its own, and online lookups are turned off, so Ponder did not check the free community index.`,
    [
      'Turn online lookups on: only the library\'s name is sent (for example "pypi/numpy"), never your code.',
      'Prefer to stay offline? Put animations you made or downloaded in a `.ponder` folder in your project.',
    ],
    [{ label: 'Turn on online lookups', command: 'ponder.enableOnlineLookup' }]),

  onlineSkipped: (name: string): Problem => p('online-skipped',
    `No animation for "${name}" yet`,
    'You chose not to check the community index this time.',
    [
      'Press Alt+W again tomorrow, or turn online lookups on now to check the index every time.',
    ],
    [{ label: 'Turn on online lookups', command: 'ponder.enableOnlineLookup' }]),

  indexUnreachable: (name: string, why: string): Problem => p('index-unreachable',
    "Couldn't reach the community index",
    `Ponder tried to look up an animation for "${name}", but ${why}. Animations downloaded before keep working offline.`,
    [
      'Check your internet connection, then click "Retry now".',
      'On a company or school network, a proxy or firewall may block github.io; VS Code\'s proxy setting is "http.proxy".',
      'Otherwise Ponder simply tries again by itself in 15 minutes.',
    ],
    [{ label: 'Retry now', command: 'ponder.retryOnline' }], true),

  brokenLibraryFile: (library: string, error: string): Problem => p('broken-library-file',
    `${library}'s animation file has a mistake`,
    `The library ships a ponder.json, but it cannot be used: ${error}`,
    [
      'You maintain this library? Run `ponder check` on the file: it shows the exact place and suggests the fix.',
      'Otherwise let the library\'s authors know. Ponder still uses animations from the community index meanwhile.',
    ]),

  needsUpdate: (message: string): Problem => p('needs-update',
    'This animation needs a newer Ponder',
    message,
    [
      'Click "Update Ponder" below (or Extensions → Ponder → Update). Updates are free and keep your settings.',
      'Then press Alt+W again.',
    ],
    [{ label: 'Update Ponder', command: 'ponder.showExtension' }], true),

  unexpected: (): Problem => p('unexpected',
    'Ponder could not look this up',
    'Something unexpected went wrong. Your code is fine and nothing was changed.',
    [
      'Press Alt+W again; most of these go away on a second try.',
      'If it keeps happening, the "Ponder" log (View → Output → Ponder) shows what failed; please include it when you report it.',
    ],
    [{ label: 'Show Ponder log', command: 'ponder.showLog' }]),
};

/** Short line for the status bar and the log. */
export function summary(problem: Problem): string {
  return `${problem.title}. ${problem.detail}`;
}

/** The notification text: what happened, plus the first thing to try. */
export function notificationText(problem: Problem): string {
  return `Ponder: ${problem.title}. ${problem.detail} Try: ${problem.tries[0] ?? ''}`.trim();
}

/** Full text for the log, with every step. */
export function longText(problem: Problem): string {
  return [
    `── ${problem.title} ──`,
    problem.detail,
    'Try:',
    ...problem.tries.map((t, i) => `  ${i + 1}. ${t}`),
  ].join('\n');
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}
