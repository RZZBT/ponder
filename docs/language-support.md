# Language support: test results

Every language has a small library with a `ponder.json` and a file that calls it in
[examples/polyglot](../examples/polyglot) (Java uses the demo jar, JavaScript `examples/js-consumer`). Each test
opens the calling file in the IDE, asks Ponder for the animation at a function call, a method call and a local
function with a similar name, and compares the result.

Last run: 2026-11-08, Windows 11.

## VS Code 1.145

`cd vscode && npm run test:languages -- --extensions-dir <dir>` runs the real language extensions:

| Language | Language extension | Ready after | Function | Method | Local look-alike ignored |
|---|---|---|---|---|---|
| JavaScript | built-in TypeScript/JavaScript | 4 s | pass | pass | pass |
| TypeScript | built-in TypeScript/JavaScript | 4 s | pass | pass | pass |
| Python | Pylance (no interpreter installed) | 27 s | pass | pass | pass |
| Rust | rust-analyzer | 63 s | pass | pass | pass |
| C++ | Microsoft C/C++ | 9 s | pass | pass | pass |
| PHP | Intelephense | 2 s | pass | pass | pass |
| Lua | Lua (sumneko) | 4 s | pass | pass | pass |
| Java (class in a jar) | Language Support for Java (Red Hat) | 17 s | pass | pass, and the constructor | pass |

25 of 25 checks pass.

## JetBrains IDEs

`./gradlew :plugin:test` (IntelliJ IDEA Ultimate) and `./gradlew :plugin:testCLion -PclionDir=<CLion folder>`
run the plugin's own test framework inside each IDE:

| Language | IDE | Function | Method | Local look-alike ignored |
|---|---|---|---|---|
| Java | IntelliJ IDEA | pass | pass, overloads and constructors | pass |
| Kotlin | IntelliJ IDEA | pass | | pass |
| Groovy | IntelliJ IDEA | pass | | overload ignored |
| JavaScript | IntelliJ IDEA | pass | pass | pass |
| TypeScript | IntelliJ IDEA | pass | pass | pass |
| Python | CLion (bundled Python plugin) | pass | pass | pass |
| Rust | CLion (bundled Rust plugin) | pass | not resolved in the test project (no Cargo model); untested in a real project | |
| C++ | CLion | not resolved: CLion resolves C++ in its language backend | | |

Not installed here, so not run: PyCharm, WebStorm, GoLand, PhpStorm, RubyMine, RustRover as standalone IDEs.
PyCharm, WebStorm, CLion, Rider, RustRover and DataGrip pass the JetBrains Plugin Verifier (the plugin loads).

## `ponder check`

All libraries in `examples/polyglot` pass, including Go and Ruby, which have no IDE run above.

## Findings that changed the recommended symbols

- **PHP:** the outline has no namespace: write `sym:src/Math.php:Math.clamp`. Add the namespaced form
  (`sym:src/Math.php:Acme.Math.clamp`) as an alias for IDEs that include it.
- **Lua:** functions on a module table keep the table name: `sym:lmath.lua:M.clamp`. Methods
  `function IntStack:push` become `IntStack.push`.
- **C++:** works in VS Code; in JetBrains IDEs use VS Code or expect nothing.
