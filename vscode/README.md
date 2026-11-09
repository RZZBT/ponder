# Ponder for VS Code

Press <kbd>Alt</kbd>+<kbd>W</kbd> on a library call to see the animation its authors wrote in `ponder.json`.

Works with any language whose extension provides Go to Definition and a document outline. Java classes inside
jars are supported through the Java extension (`jdt://` sources).

## Commands

| Command | Default key |
|---|---|
| Ponder: Open Ponder | <kbd>Alt</kbd>+<kbd>W</kbd> |
| Ponder: Copy Ponder Symbol | (editor context menu) |

`ponder.json` files get schema validation and completion.

## How a call is matched

1. VS Code's definition provider gives the declaration. Several unrelated definitions: nothing is shown.
2. From the declaration's file, the extension walks up to the package root (first folder with `ponder.json` or a
   package manifest). For `jdt://` classes it reads `META-INF/ponder/ponder.json` from the jar.
3. The outline gives the enclosing names (`IntStack`, `push`); with the file path they form the candidate symbols
   (`js:math-utils#IntStack.push`, `sym:lib/stack.js:IntStack.push`, ...).
4. The first animation whose `symbol` or `aliases` equals a candidate is shown, if `library.name` matches the
   package manifest.

## Development

```sh
npm install
npm run build             # dist/extension.js, media/ (engine and schema copies)
npm test                  # unit tests
npm run test:integration  # runs the extension in VS Code against ../examples/js-consumer
```

Package detection lives in `../engine/src/packages/layout.ts` (same algorithm as the Kotlin `PackageLayout.kt`).
