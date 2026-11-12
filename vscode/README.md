# Ponder

**See what a library function does, one step at a time, right next to your code.**

Put your cursor on a call such as `np.clip(...)` or `chunk(...)` and press <kbd>Alt</kbd>+<kbd>W</kbd>. Ponder opens a
short animation that walks through what the function does with example values: shapes move, captions explain each
step, and you go at your own pace.

No setup. No accounts. Nothing to configure.

## Where the animations come from

1. **The library itself.** Library authors can ship a `ponder.json` with their package. These animations come from
   the people who wrote the code, and Ponder always prefers them.
2. **Your own folders.** Put `ponder.json` files in a `.ponder` folder in your project, for example animations you
   made or downloaded.
3. **The community index.** For popular libraries that ship no animation yet (NumPy, lodash, date-fns,
   more-itertools and more), Ponder can fetch one from the free [Ponder Index](https://github.com/RZZBT/ponder-index).
   Every example in it is checked against the real library.

**Built-in functions too.** `sorted(...)`, `"a,b".split(",")`, `arr.map(...)`, `Math.max(...)`, `v.push(x)`,
`strings.Split(...)`: functions of the language itself (Python, JavaScript/TypeScript, Rust, Go) are looked up the
same way.

**Never a dead end.** When there is no animation, Ponder tells you why and what to try, with buttons for the fixes:
install the missing language extension, trust the folder, install a missing library, pick the Python interpreter,
retry, or update Ponder. *How to fix…* opens a page with every step.

## Your privacy

- Ponder asks **once** before it ever goes online: *Allow*, *Not now* or *Never*.
- Only the package name is requested, for example `pypi/numpy`. **Never your code**, your file names or your
  function names.
- Your own code is never looked up anywhere.
- Downloaded animations are kept on your computer, so they also work offline.

## Controls

| Key | Action |
|---|---|
| <kbd>Alt</kbd>+<kbd>W</kbd> | open Ponder for the call at the cursor |
| <kbd>→</kbd> / <kbd>←</kbd> | next / previous step |
| <kbd>Space</kbd> | play / pause |
| <kbd>A</kbd> | play all steps automatically |
| <kbd>R</kbd> | replay |
| <kbd>Esc</kbd> | close |

Ponder follows your light or dark theme and your system's reduced-motion setting.

## Languages

Works in any language whose VS Code extension supports *Go to Definition*: Python, JavaScript and TypeScript out of
the box, Java with the Java extension, and Rust, Go, C/C++, PHP, Ruby and more with their usual extensions.

## Something not working?

- **"Restricted Mode"**: VS Code turns language support off in folders you have not trusted. Click
  *Trust Folder…* when Ponder asks.
- **No animation for a function**: nobody has written one yet. Library authors can add one in an afternoon, see
  below.
- Details of every lookup: *View → Output → Ponder*.

## Settings

All optional: `ponder.onlineLookup` (ask / on / off), `ponder.localFolders`, `ponder.autoplay`,
`ponder.reducedMotion`. Command palette: *Ponder: Clear Cached Animations*.

## For library authors

Add an animation for your own functions: a `ponder.json` next to your `package.json` (or `pyproject.toml`,
`Cargo.toml`, ...). Right-click one of your functions and choose **Copy Ponder Symbol** to get its exact name, then
see the [guide](https://github.com/RZZBT/ponder/blob/main/docs/create-an-animation.md).

## License

MIT
