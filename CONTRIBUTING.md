# Contributing

## Setup

- JDK 25 (`JAVA_HOME`) for the JetBrains plugin
- Node.js 22+ for the engine and the VS Code extension
- Visual Studio 2022 with the extension development workload for `visualstudio/`

```sh
./gradlew :plugin:test       # builds the engine, runs the plugin tests
cd engine && npm install && npm test
cd vscode && npm install && npm test && npm run test:integration
```

`./gradlew :plugin:runIde` (or `run-ide.cmd`) starts a sandbox IDE with the demo project.

## Changing the format

The format is validated twice: `engine/src/parser/validate.ts` in the popup and
`plugin/src/main/kotlin/dev/ponder/format/PonderValidator.kt` in the IDE. A change to the rules needs:

1. the same change in both validators,
2. `schema/ponder.schema.json`,
3. a fixture in `schema/fixtures/` listed in `index.json` (both test suites run it),
4. `docs/ponder-format.md`.

Limits live in `engine/src/parser/limits.ts` and `PonderLimits` and must match. Symbol rules live in
`engine/src/parser/symbol.ts` and `PonderSymbols.kt`; regenerate the schema pattern from `symbolSchemaPattern()`.

## Package detection

`plugin/.../packages/PackageLayout.kt` and `engine/src/packages/layout.ts` decide which folder is a package and which
symbol strings a declaration gets. They are two copies of one algorithm with the same tests
in `schema/conformance/packages.json`, run by `ConformanceTest.kt` and `vscode/tests/conformance.test.ts`; change both.

## Changing the demo library

Edit `examples/math-utils`, then rebuild the jar used by the demo project:

```sh
./gradlew :examples:math-utils:syncDemoJar
```

## Pull requests

- Keep changes focused; one topic per PR.
- Add or update tests. `npm test` and `./gradlew :plugin:test` must pass.
- `npm run typecheck` in `engine/` must be clean.
- UI changes: include a screenshot.
