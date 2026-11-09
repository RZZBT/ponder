# Changelog

## [Unreleased]

### Added
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

### Changed
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
