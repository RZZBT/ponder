# Getting started

## Run the sandbox IDE

Windows:

```
run-ide.cmd
```

Other systems, or with your own JDK 25:

```sh
export JAVA_HOME=/path/to/jdk-25
./gradlew :plugin:runIde
```

The first start takes a few minutes. A second IntelliJ window opens with Ponder installed and
`examples/consumer` open, with its JDK and library already configured.

1. Wait until indexing finishes.
2. Open `src/main/java/demo/Main.java`.
3. Put the caret on `clamp` in `MathUtils.clamp(-4, 0, 10)`.
4. Press <kbd>Alt</kbd>+<kbd>W</kbd>.

## Install in your own IDE

```sh
./gradlew :plugin:buildPlugin
```

Then **Settings | Plugins | gear icon | Install Plugin from Disk...** and pick
`plugin/build/distributions/plugin-0.1.0.zip`. Open `examples/consumer` and choose any JDK 17+ if asked.

## The demo calls

| Call | What it shows |
|---|---|
| `MathUtils.clamp(-4, 0, 10)` | a number pushed back into a range |
| `MathUtils.isBetween(5, 3, 7)` | plays without clicks (`autoAdvance`) |
| `MathUtils.gcd(48, 18)` | Euclid's algorithm |
| `Search.binarySearch(sorted, 23)` | lo / mid / hi halving an array |
| `Strings.isPalindrome("racecar")` | two pointers |
| `Sorting.insertionSort(numbers)` | bars shifting into place |
| `Recursion.factorial(4)` | a call stack growing and unwinding |
| `new IntStack(4)`, `push`, `pop` | a constructor and instance methods |

These show a hint instead of an animation:

| Call | Why |
|---|---|
| `clamp(-4, 0, 10)` | declared in the project, not in the library |
| `MathUtils.clamp(1.5, 0.0, 1.0)` | the `double` overload has no animation |
| `Math.abs(-3)` | JDK method |

## Troubleshooting

The hint after <kbd>Alt</kbd>+<kbd>W</kbd> says why nothing was shown.

| Hint | Fix |
|---|---|
| `cannot resolve '...'` or `the project has no JDK set` | check **File \| Project Structure**: a JDK is set and `libs/math-utils-1.0.0.jar` is attached |
| `ponder.json is invalid` | **Tools \| Ponder: Show Diagnostics** lists the errors |
| `is for a different library` | `library.group` / `library.name` do not match the jar's coordinates |

- If <kbd>Alt</kbd>+<kbd>W</kbd> opens a menu, rebind *Open Ponder* under **Settings | Keymap**.
- If the popup shows a plain list of steps, the IDE runtime has no JCEF.
- Every hint is also logged with the prefix `Ponder:` (**Help | Show Log**, or
  `.intellijPlatform/sandbox/plugin/IU-*/log_runIde/idea.log` for the sandbox).

## Without an IDE

```sh
cd engine
npm install
npm run try
```

Opens the demo animations in a browser.

## Other JetBrains IDEs

The same plugin zip installs in PyCharm, WebStorm, GoLand, RustRover, PhpStorm, RubyMine, CLion, Rider and the
other IDEs on the 2026.2 platform. To try one with the demo:

```sh
./gradlew :plugin:runIdeWith "-PideDir=C:/Program Files/JetBrains/PyCharm 2026.3" -PdemoProject=examples/python
```

Open `demo.py` and press <kbd>Alt</kbd>+<kbd>W</kbd> on `clamp`. For WebStorm use
`-PdemoProject=examples/js-consumer` after running `npm install` in that folder.

## VS Code

```sh
cd vscode
npm install
npm run build
```

Open the `vscode` folder in VS Code and press <kbd>F5</kbd>. In the new window open `examples/js-consumer`
(`npm install` there first), open `main.js` and press <kbd>Alt</kbd>+<kbd>W</kbd> on `clamp`. The animation opens
in a panel beside the editor.

Any language works when its VS Code extension provides Go to Definition and an outline (Python with Pylance,
Rust with rust-analyzer, Go with gopls, C/C++ with clangd or the C/C++ extension, Java with the Java extension).

To install it permanently: `npx @vscode/vsce package` in `vscode/`, then **Extensions | ... | Install from VSIX**.

## Visual Studio

Needs Visual Studio 2022 17.10+ with the **Visual Studio extension development** workload. Open
`visualstudio/Ponder.VisualStudio.csproj` and press <kbd>F5</kbd>; an experimental instance starts with the
extension. Works for C# and Visual Basic: put the caret on a method from a NuGet package that ships `ponder.json`
and press <kbd>Alt</kbd>+<kbd>W</kbd>.
