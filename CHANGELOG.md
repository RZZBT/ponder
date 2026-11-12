# Changelog

## [Unreleased]

## [0.3.0]

### Added
- **Built-in functions.** Alt+W on a function of the language itself (`sorted`, `str.split`, `Array.map`,
  `ArrayList.add`, `Vec::push`, `strings.Split`) looks for an animation for the standard library: in `.ponder`
  folders, then in the community index under `v1/std/<language>/<module>.json`. Recognised:
  - Python: typeshed stubs (Pylance, basedpyright, Jedi, PyCharm) and CPython's own sources;
  - JavaScript/TypeScript: TypeScript's built-in `lib.*.d.ts` files;
  - Java: classes of the project's JDK (JetBrains IDEs);
  - Rust: the toolchain's `rust-src` (`core`, `alloc`, `std`);
  - Go: GOROOT, Go SDKs and downloaded toolchains.
  The language version (Python 3.12, JDK 21, Rust 1.98, Go 1.22) is used for version ranges when it is known.
- Friendly problems: every way of not finding an animation now says what happened, why, and what to **try**, with
  buttons for the fixes (install the language extension, trust the folder, select the Python interpreter, open the
  terminal, turn on online lookups, retry, update Ponder). VS Code shows a notification and a "How to fix…" page;
  JetBrains IDEs show a hint at the caret and a notification.
- Recognised setup problems: Restricted Mode, a missing or disabled language extension, a Rust/Go file outside any
  project, a library that is not installed (read from the editor's own import errors), no JDK, a broken library
  `ponder.json`, an animation that needs a newer Ponder.
- `"requires"` in ponder.json: optional features a file needs. A Ponder without one of them says "update Ponder"
  instead of failing on properties it does not know. Files with a newer format version are reported the same way.
- Shared conformance cases for standard-library recognition (`schema/conformance/stdlib.json`), run by both clients.

### Changed
- "No animation for this package" answers from the community index are checked again after an hour instead of a
  day, so newly published animations show up quickly. Found animations are still cached for a day.
- The consent question and popup labels name the standard library in words ("Python standard library (builtins)").

### Fixed
- *Retry now* after a network failure: the failure was also stored on disk and came back at once.
- Without the language extension installed, Ponder waited 15 seconds before answering; it now answers at once.

## [0.2.1]

### Added
- Animations for libraries that ship none: local folders (`<project>/.ponder/` and folders from the settings), then
  an online community index. Online lookups are off until the user allows them in a one-time prompt
  (Allow / Not now / Never). Only the package name is sent, never code, and never for the user's own code.
- Online index protocol, version 1 ([docs/online-index.md](docs/online-index.md)): static JSON files at
  `v1/<ecosystem>/<package>.json`, with version ranges per entry. Works on GitHub Pages.
- Disk cache for index answers: one lookup per package per day, works offline afterwards; stale copies are shown at
  once and refreshed in the background; failures retry after 15 minutes and never replace a good copy.
- Settings for online lookups, the index address, local folders, and a Clear Cached Animations button (JetBrains)
  or command (VS Code).
- The popup shows where an animation came from (library, local file or community index).
- `ponder check-index <folder>`: validates an index before publishing.
- Sample index in `examples/online-index` (regenerate with `generate.mjs`).
- Shared protocol conformance cases (`schema/conformance/index.json`) run by the engine and the JetBrains plugin.

### Fixed
- `ponder.json` and index files saved with a UTF-8 byte order mark (Windows Notepad) were rejected as invalid JSON.
- VS Code: in Restricted Mode (an untrusted folder) Ponder said "no definition"; it now explains the cause and
  offers Trust Folder. The installed extension also no longer gets switched off entirely in Restricted Mode.
- VS Code: a project's `.vscode/settings.json` could turn online lookups on or change the index address;
  both are now user-level settings only.

### Changed
- Release workflow: checks that the tag matches every version number, publishes a draft release, and no longer
  waits on the Visual Studio build.

### Added: more languages and IDEs
- Symbols for other languages: `py:`, `js:`, `dotnet:`, `go:`, `rust:`, `cpp:`, and `sym:` for any language.
- `ponder.json` next to a package manifest (npm, PyPI, crates, Go modules, NuGet, ...).
- JetBrains plugin loads in every IDE on the 2026.2 platform; a generic resolver covers languages without JVM support.
- VS Code extension (`vscode/`).
- Visual Studio 2022 extension for C# and Visual Basic (`visualstudio/`, not compiled yet).
- JavaScript and Python demo libraries.
- `ponder check`: confirms every symbol names a real declaration in the package (Java checked against class files).
- Shared conformance cases (`schema/conformance/packages.json`) run by the JetBrains plugin and the VS Code extension.
- VS Code settings `ponder.autoplay` and `ponder.reducedMotion`; `.vsix` package.
- Multi-language test set (`examples/polyglot`) with a VS Code runner (`npm run test:languages`) and CLion tests (`testCLion`).
- Release workflow producing installers for all three IDEs and a JetBrains `updatePlugins.xml`.

### Changed: format
- `library.group` is optional.

## [0.1.0]

### Added
- Open Ponder action (Alt+W), gutter icon and editor context menu entry.
- Copy Ponder Symbol action for library authors.
- Symbol resolution for Java and Kotlin call sites; matching by declaring class and erased parameter types.
- Library identity check against `pom.properties` or the IDE library name.
- `ponder.json` version 1: actors, slides, transitions, `autoAdvance`, timing on slides, `"//"` comments.
- TypeScript engine with SVG renderer, keyboard controls and viewer auto-advance.
- Text fallback when JCEF is unavailable.
- Tools | Ponder: Show Diagnostics.
- Demo library with ten animations and a demo project.
