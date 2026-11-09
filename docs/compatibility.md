# Making sure everyone sees your animation

A `ponder.json` that passes `ponder check` works in every Ponder client: the JetBrains plugin, the VS Code
extension and the Visual Studio extension (for the languages each one supports, see the table below).

## 1. Check the file

```sh
node ponder.cjs check path/to/your-package          # folder with package.json, Cargo.toml, ...
node ponder.cjs check build/libs/my-library.jar     # Java/Kotlin: check the built jar
```

`ponder.cjs` is attached to every release; from a clone, `cd engine && npm run check -- <path>`.

It reports, with the JSON path of each problem:

- format errors (the same validator the IDEs run),
- a `library.name` that does not match the package manifest or `pom.properties` (IDEs would hide everything),
- a `ponder.json` in a place where IDEs do not look,
- every symbol that does not name a real declaration in the package. Java symbols are checked against the
  compiled classes, including exact parameter types.

Exit code 0 means every symbol was found. Add it to your build or CI.

## 2. Use the recommended symbol form

All clients compute the same strings for these forms; the rules are pinned by shared tests
(`schema/conformance/packages.json`).

| Language | Write | Example |
|---|---|---|
| Java, Kotlin | no prefix, fully qualified erased parameter types | `com.example.MathUtils#clamp(int,int,int)` |
| Python | `py:` module path + qualified name | `py:mathutils.stack.IntStack.push` |
| JavaScript, TypeScript | `js:` package name + `#` + name | `js:math-utils#IntStack.push` |
| Rust | `rust:` crate path | `rust:math_utils::stack::IntStack::push` |
| Go | `go:` import path + `.` + name (methods: `Type.Method`) | `go:example.com/m/stack.IntStack.Push` |
| C, C++ | `cpp:` qualified name; add parameters only for overloads | `cpp:math::clamp` |
| C#, Visual Basic | `dotnet:` documentation id | `dotnet:M:Math.Utils.Clamp(System.Int32,System.Int32,System.Int32)` |
| PHP | `sym:` file + class + method, without the namespace (add the namespaced form as an alias) | `sym:src/Math.php:Math.clamp` |
| Lua | `sym:` file + table + function | `sym:lmath.lua:M.clamp` |
| anything else | `sym:` file in the package + enclosing names | `sym:lib/stack.rb:IntStack.push` |

**Copy Ponder Symbol** (editor context menu, every client) gives the string for the method under the cursor.

Constructors: Java `#<init>(...)`; JavaScript the class name, alias `Class.constructor`; Python the class name,
alias `Class.__init__`. List both forms when in doubt; `aliases` costs nothing.

## 3. Ship the file where IDEs look

| Ecosystem | Location |
|---|---|
| Java, Kotlin | `src/main/resources/META-INF/ponder/ponder.json` (ends up in the jar). Maven adds `pom.properties`; Gradle needs the small task in `examples/math-utils/build.gradle.kts` |
| npm | next to `package.json`, and listed in `"files"` |
| Python | inside the top-level package folder, next to `__init__.py`, and listed as package data |
| Rust | next to `Cargo.toml` |
| Go | next to `go.mod` |
| NuGet | package root (`<None Include="ponder.json" Pack="true" PackagePath="" />`) |

## What each client supports

See [language-support.md](language-support.md) for the languages tested in each IDE and the results.

## Version guarantee

`"version": 1` files keep working in every later client. A new format version will be read next to version 1
for at least one major release.
