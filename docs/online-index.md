# The online index

Most libraries will never ship a `ponder.json` of their own. The online index fills that gap: a plain folder of
JSON files on any static web host (GitHub Pages works well). When a library has no animation, Ponder can look the
package up there.

This page is for people who **publish** an index. Users need to know only one thing: the first time a library has
no animation, Ponder asks before it ever goes online.

## Where Ponder looks, in order

1. **The library itself.** Its own `ponder.json` (inside the jar, or next to `package.json`, `pyproject.toml`, ...).
2. **Local folders.** Every `*.json` ponder file in `<project>/.ponder/`, plus the folders listed in the settings.
   Useful for animations you wrote yourself or downloaded, and for working offline.
3. **The online index**, only when the user has allowed it.

Steps 2 and 3 apply only to **identified packages** (a jar with Maven coordinates, an npm dependency, an installed
Python distribution, ...) and, since Ponder 0.3, to the **standard library** of a language (see below). Your own
code is never looked up anywhere: it would leak the names of your classes.
A file is only ever used for the package its `library` names, so a file for `numpy` can never explain a function of
another package.

## What is sent

One HTTPS `GET` per package, for example:

```
GET https://example.github.io/ponder-index/v1/pypi/numpy.json
```

That is all: the package name is in the address. No code, no file names, no function names, no version, no
cookies, no identifiers. The answer is cached on disk, so after one lookup the package works offline.

| Answer | What Ponder does |
| --- | --- |
| `200` with a valid file | Uses it. Cached for **24 hours**; after that the cached copy is still shown at once and a newer one is fetched quietly in the background for next time. |
| `404` or `410` | "No animation for this package." Checked again after **1 hour**, so a newly published file shows up the same day. |
| Network or server problem | Shows a short reason (for example "you seem to be offline"), keeps using any older good copy, and tries again after 15 minutes. |
| A broken file | Ignored; an older good copy keeps working. Details go to Tools / Ponder: Show Diagnostics (JetBrains) or the Ponder output channel (VS Code). |

Requests time out after a few seconds, responses are capped at 2 MB, and only a few redirects are followed. Nothing
here can freeze the editor or show the user a stack trace.

## Settings

| | JetBrains (Settings / Tools / Ponder) | VS Code |
| --- | --- | --- |
| Online lookups | Ask first (default), On, Off | `ponder.onlineLookup`: `ask`, `on`, `off` |
| Index address | Index URL | `ponder.indexUrl` |
| Extra local folders | Local folders, one per line | `ponder.localFolders` |
| Clear the cache | Clear Cached Animations button | Ponder: Clear Cached Animations |

Online lookups and the index address are personal settings: a project's own `.vscode/settings.json` cannot turn
lookups on or send them to another server. (JetBrains settings are always per user.)

The address must be `https://`. Plain `http://` is accepted only for `localhost`, `127.0.0.1` and `[::1]`, so you
can test an index on your own machine. A local address is never treated as fresh: each lookup fetches again, so
your edits show up (open the animation a second time to see a change in a file that was already cached).

## File layout

```
<base>/v1/<ecosystem>/<package>.json
```

| Ecosystem | Package name | Example path |
| --- | --- | --- |
| `maven` | `group:artifact` | `v1/maven/com.google.guava/guava.json` |
| `npm` | `name` or `@scope/name` | `v1/npm/lodash.json`, `v1/npm/@types/node.json` |
| `pypi` | distribution name | `v1/pypi/scikit-learn.json` |
| `crates` | crate name | `v1/crates/serde-json.json` |
| `go` | module path | `v1/go/github.com/gorilla/mux.json` |
| `packagist` | `vendor/name` | `v1/packagist/monolog/monolog.json` |
| `nuget` | package id | `v1/nuget/newtonsoft.json.json` |
| `std` | `<language>/<module>` (Ponder 0.3) | `v1/std/python/builtins.json`, `v1/std/go/net/http.json` |

Names are written in their **canonical** form, because web hosts like GitHub Pages are case-sensitive:

- npm, Packagist, NuGet: lower case.
- PyPI: lower case, and every run of `-`, `_`, `.` becomes one `-` (PEP 503): `Scikit_Learn` → `scikit-learn`.
- crates: lower case, `_` becomes `-`.
- Maven and Go: exactly as written (case-sensitive). Maven's `:` becomes a folder.
- std: the language in lower case, the module exactly as written (`javascript/Array` is not `javascript/array`).

`ponder check-index` (below) tells you if a file has the wrong name.

## Standard library (Ponder 0.3)

Built-in functions have no package, so the index names them by **language and module**. Ponder recognises the
standard library from the file the editor jumps to, and requests one file per module:

| Language | Module is | Example functions | File | Symbol |
| --- | --- | --- | --- | --- |
| `python` | the module, dotted | `sorted`, `str.split`, `list.append` | `v1/std/python/builtins.json` | `py:builtins.sorted`, `py:builtins.str.split` |
| | | `os.path.join` | `v1/std/python/os.path.json` | `py:os.path.join` |
| `javascript` | the global object (`Array`, `String`, `Math`, `JSON`, `Console`), or `globals` | `arr.map`, `Array.from`, `Math.max`, `parseInt` | `v1/std/javascript/Array.json` | `js:std#Array.map`, `js:std#Array.from`, `js:std#parseInt` |
| `java` | the package | `list.add`, `Math.abs` | `v1/std/java/java.util.json` | `java.util.ArrayList#add(java.lang.Object)` |
| `rust` | crate and first module | `Vec::push`, `Iterator::map` | `v1/std/rust/alloc.vec.json`, `v1/std/rust/core.iter.json` | `rust:alloc::vec::Vec::push` |
| `go` | the import path | `strings.Split`, `http.ListenAndServe` | `v1/std/go/strings.json`, `v1/std/go/net/http.json` | `go:strings.Split` |

A standard-library file is an ordinary index file with `"ecosystem": "std"` and `"name": "python/builtins"`; each
`ponder.library.name` must be the same `python/builtins`. Version ranges compare against the **language** version
(`"versions": ">=3.10"` for Python 3.10 and later); when the version is unknown, only entries without a range apply.

Symbols are built from where the definition lives, as everywhere else: Rust's `Vec::push` is defined in
`alloc::vec`, so its symbol is `rust:alloc::vec::Vec::push`, and JavaScript's `Array.from` lives on
`ArrayConstructor` (both `js:std#ArrayConstructor.from` and `js:std#Array.from` match). *Copy Ponder Symbol* on a
call in the editor gives the exact strings. The recognised locations are listed in
`schema/conformance/stdlib.json`.

## File format

```json
{
  "ponderIndex": 1,
  "ecosystem": "pypi",
  "name": "mathutils",
  "documents": [
    {
      "versions": ">=1.0 <2",
      "ponder": { "version": 1, "library": { "name": "mathutils" }, "animations": { "...": {} } }
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `ponderIndex` | Always `1`. A client that does not know the number ignores the file. |
| `ecosystem`, `name` | Must match the path. A file served for another package is rejected as a whole. |
| `documents` | Up to 32 entries. Each holds a complete `ponder.json` ([format](ponder-format.md)) under `ponder`. |
| `documents[].versions` | Optional. Which installed versions the entry applies to. Leave it out to apply to all. |
| `documents[].ponder.library` | Must name the same package (`group` and `name` for Maven). |

Ponder uses the **first** entry whose version range fits the installed version and that has an animation for the
function. So put entries for newer versions first, and a catch-all entry without `versions` last, if you have one.

An entry that is invalid is skipped on its own; the other entries in the file keep working. Files may be saved with
or without a UTF-8 byte order mark.

### Version ranges

Comparators separated by spaces or commas, all of which must hold:

| Range | Matches |
| --- | --- |
| *(absent)* or `*` | every version, also when the installed version is unknown |
| `>=1.20 <2` | 1.20 up to, not including, 2.0 |
| `1.2.0` or `=1.2` | exactly 1.2 (`1.2` and `1.2.0` are equal) |
| `>3`, `<=1.26.4` | as written |

`v1.2`, pre-releases (`2.0.0-rc.1`, older than `2.0.0`) and build suffixes (`1.26.4+local`, ignored) are understood.
When Ponder cannot tell the installed version, only entries without a range (or with `*`) are used: an animation
written for other versions is never shown by guesswork. A range Ponder cannot read matches nothing.

## Publishing on GitHub Pages

1. Create a public repository, for example `ponder-index`.
2. Copy `examples/online-index/` from this repository as a starting point: it contains the `v1/` folder with three
   sample packages, and an empty `.nojekyll` file (it tells GitHub to publish the files as they are).
3. Add your files under `v1/`, then check the folder:

   ```
   node engine/dist/ponder.cjs check-index path/to/ponder-index
   ```

   It is stricter than the IDEs: anything they would skip is an error here, and so is a file name they would never
   request. It exits with code 1 if anything is wrong, so you can run it in CI.
4. Commit and push, then in the repository: Settings / Pages / Deploy from a branch / `main`, folder `/ (root)`.
5. After a minute, open `https://<user>.github.io/ponder-index/v1/npm/math-utils.json` in a browser to confirm.
6. Put `https://<user>.github.io/ponder-index/` in the IDE settings, or change the default address in the source
   (`DEFAULT_INDEX_URL` in `PonderSettings.kt` and `vscode/src/external.ts`, and `ponder.indexUrl` in
   `vscode/package.json`) before building a release.

### Testing locally first

Serve the folder on your machine and point the IDE at it:

```
npx --yes http-server path/to/ponder-index -p 8123
```

Then set the index address to `http://localhost:8123/`.

## For client authors

The rules (paths, names, version ranges, file checks) live in `engine/src/sources/index-protocol.ts` and its Kotlin
port `plugin/src/main/kotlin/dev/ponder/sources/IndexProtocol.kt`. Both run the shared cases in
`schema/conformance/index.json`; a new client should run them too.
