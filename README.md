# Ponder

**Animated explanations of library functions, right inside your IDE.**

Put the caret (or the mouse pointer) on a call into a library, press <kbd>Alt</kbd>+<kbd>W</kbd>, and a short
step-by-step animation shows what that function does: a number sliding to the nearest boundary for `clamp`, a
search window shrinking for `binarySearch`. Library authors write the animation as a small JSON file and ship it
inside their package. Ponder is not an AI explainer: every animation is deterministic and written by the people
who know the function best.

```java
int i = Search.binarySearch(sorted, 23);   // press Alt+W on binarySearch
```

```
ponder: How binarySearch() works                                 [expand] [close]
+---------------------------------------------------------------------------------+
|    2    5    8   12   16   23   38   56   72   91                               |
|                            lo                  hi                               |
+---------------------------------------------------------------------------------+
> 16 < 23, so 23 can only be to the right of mid. Drop the left half: lo = mid + 1 = 5.
[< prev] [pause] [next >] [replay] [auto: off]                         step 3/7  waiting
```

## Why it is trustworthy

An animation belongs to the **exact function** your call resolves to, never to a name:

- The IDE's own "go to definition" decides which function a call means. A method with the same name in your own
  code, or another overload of the library function, never shows the wrong animation.
- The `ponder.json` must sit in the package that declares the function, and its `library.name` must match that
  package. A file from a different library is ignored.
- If anything is unclear, Ponder shows nothing. A missing animation is always preferred over a wrong one.

## Supported IDEs

| IDE | Folder | Languages |
|---|---|---|
| JetBrains IDEs 2026.2+ (IntelliJ IDEA, PyCharm, WebStorm, GoLand, RustRover, PhpStorm, RubyMine, CLion, Rider, DataGrip, ...) | [plugin/](plugin) | Java and Kotlin with exact JVM signatures; other languages through the IDE's reference resolution |
| VS Code 1.90+ | [vscode/](vscode) | any language whose extension provides Go to Definition and an outline; Java classes in jars through the Java extension |
| Visual Studio 2022 (17.10+) | [visualstudio/](visualstudio) | C# and Visual Basic. **Source only, not compiled yet** |

How well a language works depends on the IDE's own support. See [docs/language-support.md](docs/language-support.md)
for what was tested where. In Rider and CLion, C# and C++ resolution runs in a separate backend that Ponder cannot
reach, so those languages may show nothing there.

## Install

**From a release** (when you have one built, see [Building](#building)):

| IDE | How |
|---|---|
| JetBrains IDEs | **Settings → Plugins → ⚙ → Install Plugin from Disk…** and pick `ponder-jetbrains-<version>.zip`. For automatic updates, add the release's `updatePlugins.xml` URL under **Manage Plugin Repositories** instead |
| VS Code | `code --install-extension ponder-vscode-<version>.vsix` |
| Visual Studio 2022 | double-click `ponder-visualstudio-<version>.vsix` |

There is nothing to configure. Open a project that uses a library which ships a `ponder.json`, put the caret on a
call and press <kbd>Alt</kbd>+<kbd>W</kbd>.

**From source**, to try the demo without installing anything:

```sh
./gradlew :plugin:runIde        # or run-ide.cmd on Windows: a sandbox IntelliJ IDEA with the plugin
```

Open `src/main/java/demo/Main.java`, put the caret on `clamp` in `MathUtils.clamp(-4, 0, 10)` and press
<kbd>Alt</kbd>+<kbd>W</kbd>. The same file also has a local `clamp`, another overload and an unrelated call. They show
nothing, which is the point. More walkthroughs (other JetBrains IDEs, VS Code): [docs/getting-started.md](docs/getting-started.md).

## Using it

| Key | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>W</kbd> | open Ponder for the call under the mouse pointer, or at the caret |
| <kbd>→</kbd> / <kbd>←</kbd> | next / previous step |
| <kbd>Space</kbd> | play / pause |
| <kbd>A</kbd> | auto-advance on / off |
| <kbd>R</kbd> | replay |
| <kbd>E</kbd> | expand / compact |
| <kbd>Esc</kbd> | close |

The editor context menu has **Open Ponder** and **Copy Ponder Symbol**. In JetBrains IDEs a small gutter icon marks
calls that have an animation, settings are under **Settings → Tools → Ponder**, and the shortcut can be changed
under **Settings → Keymap** (action *Open Ponder*). Plain typing is never intercepted; <kbd>Alt</kbd>+<kbd>W</kbd>
is a normal, rebindable action. Ponder follows the IDE's light or dark theme and the operating system's
reduced-motion setting (steps then switch instantly and nothing advances by itself).

---

## Writing a `ponder.json`

A `ponder.json` has three ideas:

1. **Actors**: the shapes on the stage (circles, text, lines, arrows, ...), each with a stable id.
2. **Slides**: the steps. Each slide lists only what *changes*; everything else is inherited.
3. **Transitions**: how a slide is reached. Smooth (`fluid`) or instant (`direct`), by itself (`auto`) or when the
   viewer presses Next. Timing is written directly on the slide.

### Minimal example

```json
{
  "version": 1,
  "library": { "name": "mathutils" },
  "animations": {
    "abs": {
      "symbol": "py:mathutils.abs",
      "title": "How abs() works",
      "autoAdvance": true,
      "actors": {
        "dot":   { "type": "circle", "x": 290, "y": 300, "radius": 20, "fill": "danger" },
        "label": { "type": "text", "x": 500, "y": 180, "text": "abs(-6) = ?" }
      },
      "slides": [
        { "caption": "Start with x = -6." },
        { "caption": "It is 6 steps from 0, so it moves to +6.",
          "duration": 900,
          "changes": { "dot": { "x": 710, "fill": "success" } } },
        { "caption": "abs(-6) = 6", "changes": { "label": { "text": "abs(-6) = 6" } } }
      ]
    }
  }
}
```

The stage is 1000 × 600 units with the origin at the top-left and *y* growing downwards; it scales to fit the
window. Colors are `#rrggbb` (also `#rgb`, `#rrggbbaa`) or a theme token that adapts to light and dark:
`text`, `muted`, `accent`, `accent2`, `success`, `warning`, `danger`, `surface`, `none`.
A `"//"` key is a comment and is allowed in every object.

### 1. Name the function: `symbol`

A prefix tells Ponder which language the symbol is in. **The easiest way to get the exact string is to put the
caret on the function and use "Copy Ponder Symbol" from the editor context menu.**

| Language | Write | Example |
|---|---|---|
| Java, Kotlin | no prefix: `package.Class#method(types)` with fully qualified, erased parameter types (`<init>` for constructors) | `com.example.MathUtils#clamp(int,int,int)` |
| Python | `py:` module path + qualified name | `py:mathutils.stack.IntStack.push` |
| JavaScript, TypeScript | `js:` package name + `#` + exported name | `js:math-utils#IntStack.push` |
| Rust | `rust:` crate path | `rust:math_utils::stack::IntStack::push` |
| Go | `go:` import path + `.` + name | `go:example.com/mathutils.Clamp` |
| C, C++ | `cpp:` qualified name (parameters only for overloads) | `cpp:math::clamp` |
| C#, Visual Basic | `dotnet:` documentation id | `dotnet:M:MathUtils.Clamp(System.Int32,System.Int32,System.Int32)` |
| anything else | `sym:` file in the package + `:` + enclosing names | `sym:lib/stack.rb:IntStack.push` |

Matching is by exact string. Use `"aliases": [...]` for extra forms of the same function (for example an
overload that forwards to it).

### 2. Put the file where IDEs look

| Ecosystem | Location |
|---|---|
| Java, Kotlin | `src/main/resources/META-INF/ponder/ponder.json`, so it ends up inside the jar |
| npm | `ponder.json` next to `package.json`, and listed in `"files"` |
| Python | in the top-level package folder, next to `__init__.py`, and included as package data |
| Rust | next to `Cargo.toml` |
| Go | at the module root, next to `go.mod` |
| .NET (NuGet) | at the package root |
| anything else | at the package root |

The IDE starts at the file that declares the function and walks up to the package root, the first folder with a
`ponder.json` or a package manifest. It never walks past a package root, so one package cannot pick up another
package's file. For Java, `library.name` is checked against the artifact id in `pom.properties` (Maven writes it
into the jar; with Gradle see `examples/math-utils/build.gradle.kts`).

### 3. Check it, then preview it

```sh
cd engine && npm install
npm run check -- path/to/your-package     # format errors, wrong library name, misplaced file, symbols that name no real function
npm run try   -- path/to/ponder.json      # preview the animation in your browser while you edit
```

`ponder check` exits with 0 only when every symbol names a real declaration in the package, so it works well in CI.
Errors name the exact JSON path and suggest fixes (`Did you mean "strokeWidth"?`). In the IDE, problems found in
libraries are listed under **Tools → Ponder: Show Diagnostics**.

### What you can put in an animation

| Part | Options |
|---|---|
| Actors | `rectangle`, `circle`, `ellipse`, `text`, `line`, `arrow`, `polygon`, `group` (children move with the group) |
| Common properties | `x`, `y`, `rotation`, `scale`, `opacity`, `visible`, `z`, plus size and paint properties per type |
| Slides | `caption`, `changes`, timing, optional `id` |
| Timing | `trigger` (`auto`/`next`), `style` (`fluid`/`direct`), `duration`, `delay`, `easing`, `stagger` |
| Animation | `autoAdvance` (`true` or a number of ms), `scene` (size, background), `aliases`, `description` |

Fluid transitions interpolate positions, size, rotation, scale, opacity and colors. An actor that appears or
disappears only fades. The end state of a transition always equals the next slide exactly.

Complete reference with every property, default and limit: **[docs/ponder-format.md](docs/ponder-format.md)**.
Step-by-step guide: [docs/create-an-animation.md](docs/create-an-animation.md). Editor completion and
validation: add `"$schema"` pointing at [schema/ponder.schema.json](schema/ponder.schema.json).

Complete examples (the same ten animations, from `clamp` to insertion sort and recursion):
[Java](examples/math-utils/src/main/resources/META-INF/ponder/ponder.json),
[JavaScript](examples/js-math-utils/ponder.json), [Python](examples/python/mathutils/ponder.json).

---

## Building

Requirements: JDK 25 for the JetBrains plugin, Node.js 22+ for the engine and the VS Code extension, and, for the
Visual Studio extension, Visual Studio 2022 with the "Visual Studio extension development" workload.

```sh
./gradlew :plugin:test          # builds the engine and runs the plugin tests
./gradlew :plugin:buildPlugin   # plugin/build/distributions/plugin-<version>.zip
./gradlew :plugin:verifyPlugin  # JetBrains Plugin Verifier

cd engine && npm test           # engine tests
cd vscode && npm run package    # VS Code .vsix
```

To build against a locally installed IDE instead of downloading one, add
`-PplatformLocalPath="/path/to/IntelliJ IDEA"`.

```
engine/        TypeScript: parser, validator, player, SVG renderer, UI (shared by every IDE)
plugin/        JetBrains plugin (Kotlin)
vscode/        VS Code extension (TypeScript)
visualstudio/  Visual Studio extension (C#)
schema/        JSON schema and validator fixtures shared by the engine and the plugin
examples/      demo libraries and projects (Java, JavaScript, Python and more)
docs/          guides and the format reference
```

## Security

`ponder.json` comes from third-party packages, so it is treated as untrusted. It is size-, depth- and range-limited and
never executed; text is rendered as plain text, never as HTML. Every IDE runs the bundled engine under a
Content-Security-Policy with no network access, and only a fixed set of messages from the page is accepted.

## Limitations

- Functions, methods and constructors only, not fields.
- VS Code shows the animation in an editor panel beside the code, not a popup.
- The Visual Studio extension has not been compiled yet.
- Without JCEF (the embedded browser), the JetBrains popup lists the steps as text instead of playing them.
- Go methods differ between IDEs (`go:mod.IntStack.Push` in VS Code, `go:mod.Push` in JetBrains IDEs); list both with `aliases`.

## Contributing and license

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [changelog](CHANGELOG.md). MIT, see [LICENSE](LICENSE).
