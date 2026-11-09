# ponder.json format (version 1)

One file per library, shipped with the library (see [Where the file goes](#where-the-file-goes)). Add `"$schema"`
pointing at `schema/ponder.schema.json` for editor completion. Two concepts: **actors** (things on stage) and
**slides** (states of the stage, each saying how it is reached).

```json
{
  "version": 1,
  "library": { "group": "com.example", "name": "math-utils" },
  "animations": {
    "clamp-int": {
      "//": "Comments like this one are allowed in every object.",
      "symbol": "com.example.math.MathUtils#clamp(int,int,int)",
      "title": "How clamp() works",
      "autoAdvance": true,
      "actors": {
        "number": { "type": "circle", "x": 170, "y": 360, "radius": 26, "fill": "accent" },
        "limit":  { "type": "line", "x": 350, "y": 290, "width": 0, "height": 140, "stroke": "warning" }
      },
      "slides": [
        { "caption": "The number is below the minimum." },
        { "caption": "It stops at the minimum.", "duration": 900, "changes": { "number": { "x": 350 } } }
      ]
    }
  }
}
```

Examples: the same ten animations for
[Java](../examples/math-utils/src/main/resources/META-INF/ponder/ponder.json),
[JavaScript](../examples/js-math-utils/ponder.json) and [Python](../examples/python/mathutils/ponder.json).
Guide: [create-an-animation.md](create-an-animation.md).

## Notes
- Slide changes are nested under `changes`, so an actor may be called `id` or `caption`.
- Slide *k* = defaults + declarations + changes of slides 0..k. List only what changes.
- Timing is written on the slide it leads to. A separate `transitions` list is also supported.
- A `"//"` key is a comment (a string or a list of strings) and is allowed in every object.
- No expressions, scripts or HTML. Text is rendered as plain text.

## Where the file goes

| Ecosystem | Location |
|---|---|
| Java, Kotlin (jar) | `META-INF/ponder/ponder.json` in the jar (`src/main/resources/META-INF/ponder/ponder.json`) |
| npm | `ponder.json` next to `package.json`; list it in `"files"` |
| Python | `ponder.json` in the top-level package folder (next to `__init__.py`); add it to package data |
| Rust | `ponder.json` next to `Cargo.toml` (included in the crate by default) |
| Go | `ponder.json` at the module root, next to `go.mod` |
| .NET (NuGet) | `ponder.json` at the package root, or embedded as a resource named `ponder.json` |
| anything else | `ponder.json` at the package root |

The IDE starts at the file that declares the function and walks up to the package root: the first folder with a
`ponder.json` or a package manifest (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, ...). It never
walks past a package root, so one package cannot pick up another package's file.

## Top level
| Property | Meaning |
|---|---|
| `version` | Must be `1`. |
| `library.name` | Package name: Maven artifactId, npm, PyPI, crate or NuGet name, or Go module path. Checked against the package that declares the function when the IDE can tell (`pom.properties`, `package.json`, `Cargo.toml`, ...). A mismatch hides the animation. |
| `library.group` | Maven groupId. JVM only, optional. |
| `library.version` | Informational. |
| `animations` | Map of animation id to animation (at most 64). |

## Animation
| Property | Meaning |
|---|---|
| `symbol` | The function or method, see [Symbols](#symbols). Matching is by exact string. |
| `aliases` | Extra symbols (e.g. forwarding overloads) showing the same animation. |
| `title`, `description` | Header text. |
| `scene` | `{ width, height, background }`. Default 1000 x 600 logical units, origin top-left, y downward, scaled to fit. |
| `autoAdvance` | `true`: every slide moves on by itself after 1.5 s. A number: after that many ms. Omitted: each slide waits for **Next**. A slide with `"trigger": "next"` still waits (a pause point). |
| `actors`, `slides`, `transitions` | See below. |

## Symbols

A prefix names the language. Use **Copy Ponder Symbol** in the editor to get the exact string.

| Prefix | Form | Example |
|---|---|---|
| none or `jvm:` | `package.Class#method(param types)`, fully qualified erased types, `#<init>` for constructors | `com.example.MathUtils#clamp(int,int,int)` |
| `py:` | module path and qualified name | `py:mathutils.stack.IntStack.push` |
| `js:` | package name (optionally `/subpath`), `#`, exported name | `js:math-utils#IntStack.push` |
| `dotnet:` | .NET documentation comment id | `dotnet:M:MathUtils.Clamp(System.Int32,System.Int32,System.Int32)` |
| `go:` | import path, `.`, name | `go:example.com/mathutils.Clamp` |
| `rust:` | crate path | `rust:math_utils::stack::IntStack::push` |
| `cpp:` | qualified name, parameters optional | `cpp:math::clamp(int,int,int)` |
| `sym:` | file path inside the package, `:`, enclosing names | `sym:lib/stack.rb:IntStack.push` |

`sym:` works for every language: the IDE builds it from the file that declares the function and the names that
enclose it. The other prefixes stay the same when files move inside the package. `aliases` can list several forms.
JavaScript constructors: the class (`js:pkg#IntStack`) and `js:pkg#IntStack.constructor`.
Python constructors: the class and `__init__`.

## Actors
Common: `x`, `y` (anchor), `rotation` (degrees, clockwise, around the anchor), `scale`, `opacity` (0 to 1), `visible`, `z`, and
`parent` (id of a `group`; declaration only). Anchor = centre for `rectangle`, `circle`, `ellipse`, `text`; start point for
`line`, `arrow`, `polygon`, `group`.

| Type | Extra properties |
|---|---|
| `rectangle` | `width`, `height`, `cornerRadius`, `fill`, `stroke`, `strokeWidth` |
| `circle` | `radius`, `fill`, `stroke`, `strokeWidth` |
| `ellipse` | `width`, `height` (full size), paint |
| `text` | `text` (up to 500 chars), `fontSize`, `fill`, `anchor` (`start`/`middle`/`end`) |
| `line`, `arrow` | `width`, `height` (vector from the anchor, may be negative), `stroke`, `strokeWidth` |
| `polygon` | `points` `[[x,y], ...]` (3 to 64, relative to the anchor), paint |
| `group` | none; children use parent-relative coordinates |

Colors: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, or a theme token that adapts to dark/light: `text`, `muted`, `accent`,
`accent2`, `success`, `warning`, `danger`, `surface`, `none`.

## Slides
`{ "caption"?, "changes"?: { actorId: { property: value } }, "id"?, ...timing }`. `type` and `parent` cannot change.
`id` is only needed when a `transitions` entry refers to the slide.

**Timing** (how this slide is reached; not allowed on the first slide): the properties in the table below, written
directly on the slide, e.g. `{ "caption": "...", "trigger": "auto", "duration": 800, "changes": { ... } }`.

When several places say something, the most specific wins: `autoAdvance` < a `transitions` entry < the slide itself.
Setting the same slide's timing both on the slide and in `transitions` is an error (keep it in one place).

## Timing properties (on a slide, or in a `transitions` entry)
A `transitions` entry is `{ "to": "<slide id>", "from"?: "<the slide just before>", ...timing }`.

| Property | Default | Meaning |
|---|---|---|
| `trigger` | `next` (`auto` with `autoAdvance`) | `auto`: advances itself after `delay`; `next`: waits for the user |
| `style` | `fluid` | `direct`: instant switch; `fluid`: interpolate |
| `duration` | 600 | ms (ignored for `direct`) |
| `delay` | 500 for `auto` (the `autoAdvance` pause with `autoAdvance`), 0 for `next` | dwell on the previous slide |
| `easing` | `ease-in-out` | `linear`, `ease-in`, `ease-out`, `ease-in-out`, `back-out`, or `[x1,y1,x2,y2]` |
| `stagger`, `order` | 0 | ms between actors; `order` lists the actors to stagger (others start with the first) |

Fluid rules: numbers and colors interpolate; an actor that appears or disappears only fades (no sliding from nowhere);
text, `z` and `anchor` switch at the midpoint; polygons with equal point counts morph, otherwise they switch shape at the
midpoint. The end state always equals the target slide exactly.

Viewers can also press `A` (or the `auto` button) to make waiting slides continue by themselves after 1.5 s,
whatever the file says.

## Limits
| Limit | Maximum |
|---|---|
| file size | 256 KB |
| nesting depth | 32 |
| animations | 64 |
| actors | 200 |
| slides, transitions | 60 each |
| polygon points | 64 |
| group depth | 8 |
| duration, delay | 10 s |
| total running time | 120 s |
| coordinate (absolute) | 100000 |
| text / caption length | 500 / 400 |

A file over any limit is rejected; *Tools | Ponder: Show Diagnostics* shows the JSON path of the problem.

## Versioning and migration
`version` is an integer. A reader accepts only versions it knows. Additive changes (new optional properties, actor types,
easings) stay in version 1 only if old readers still reject nothing they previously accepted; otherwise the version is
bumped. A breaking change (v2) ships with a documented one-page migration, and the IDE keeps reading v1 files for at least
one major release.
