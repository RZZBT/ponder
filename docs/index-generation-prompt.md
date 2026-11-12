# Prompt: generate the Ponder index for GitHub Pages

One prompt that writes the finished index files, laid out so the folder can be pushed to a GitHub Pages repository
as it is. Works with a chat assistant (it prints each file) or a coding agent with file access (it writes them).

Edit the package list in `<packages>` if you like, then copy everything inside the box.

````text
<role>
You are writing the public Ponder index: a folder of JSON files, published on GitHub Pages, that the Ponder IDE
plugin downloads to show beginners a short, step-by-step animation of how a popular library function works.
Every file must pass a strict validator, and every animation must be factually correct, because beginners will
trust it. Correctness beats quantity: skip a function rather than guess.
</role>

<packages>
Write one index file per package below, with one animation per listed function. These are third-party packages;
Ponder never looks up standard-library functions, so do not add any.

| ecosystem | package                          | versions | functions |
|-----------|----------------------------------|----------|-----------|
| npm       | lodash                           | >=4 <5   | chunk, groupBy, uniq, flatten, debounce |
| npm       | date-fns                         | >=2      | addDays, differenceInDays, startOfWeek |
| pypi      | numpy                            | >=1.20   | clip, argsort, cumsum, reshape |
| pypi      | more-itertools                   | >=8      | chunked, windowed, flatten |
| maven     | com.google.guava:guava           | >=20     | Lists.partition, Strings.padStart, Ints.constrainToRange |
| maven     | org.apache.commons:commons-lang3 | >=3.0    | StringUtils.abbreviate, StringUtils.center, ArrayUtils.reverse |
| crates    | itertools                        | >=0.10   | interleave, dedup |
| go        | github.com/samber/lo             | >=1.0    | Chunk, Uniq, GroupBy |
| packagist | illuminate/collections           | >=8      | Arr::flatten, Collection::chunk |
</packages>

<research>
Before writing an animation, establish two facts for each function, from the package's actual source code if you
can read it (installed package, repository or registry), otherwise from its official documentation:
1. What it returns for a small concrete example, worked out step by step.
2. The file where it is DEFINED (not re-exported), which determines its symbol.
If you cannot establish both with confidence, skip the function and list it under "Skipped" with the reason.
Never invent a function, a parameter or a behaviour.
</research>

<folder_layout>
ponder-index/
  .nojekyll                        (empty file: tells GitHub Pages to publish files as they are)
  index.html                       (small page listing the packages and animations; plain HTML, no scripts)
  v1/<ecosystem>/<name>.json       (one per package)

File names use the canonical package name (the host is case-sensitive):
- npm: lower case; a scoped "@scope/name" becomes the folders "@scope/name.json".
- pypi: lower case, every run of "-", "_", "." becomes one "-" (more_itertools -> more-itertools.json).
- maven: "group:artifact" becomes "v1/maven/<group>/<artifact>.json", case kept.
- crates: lower case, "_" becomes "-". go: module path kept exactly, slashes become folders.
- packagist: lower case "vendor/name" becomes folders.
Examples: v1/npm/lodash.json, v1/maven/com.google.guava/guava.json, v1/go/github.com/samber/lo.json
</folder_layout>

<index_file>
{
  "ponderIndex": 1,
  "ecosystem": "<npm|pypi|maven|crates|go|packagist>",
  "name": "<package name exactly as in the table>",
  "documents": [
    {
      "versions": "<range from the table>",
      "ponder": {
        "version": 1,
        "library": { "name": "<package name>" },
        "animations": { "<animation-id>": <ANIMATION>, ... }
      }
    }
  ]
}
For maven, "library" is { "group": "<groupId>", "name": "<artifactId>" }.
For go and packagist, "library.name" is the full module path / "vendor/name".
Version ranges: comparators separated by spaces, each >=x, >x, <=x, <x or =x, all must hold.
</index_file>

<animation_format>
ANIMATION:
{
  "symbol": "<exact symbol, see symbols>",
  "aliases": ["<other spellings>"],
  "title": "How chunk() works",
  "description": "<one plain sentence>",
  "actors": { "<actor-id>": <ACTOR>, ... },
  "slides": [ <SLIDE>, ... ]
}

ACTOR: { "type", "x", "y", type properties, optional "visible", "opacity", "rotation", "scale", "z", "parent" }
  rectangle: width, height, cornerRadius, fill, stroke, strokeWidth        (x,y = centre)
  circle:    radius, fill, stroke, strokeWidth                             (x,y = centre)
  ellipse:   width, height, fill, stroke, strokeWidth                      (x,y = centre)
  text:      text (<=500 chars), fontSize, fill, anchor "start"|"middle"|"end"   (x,y = centre)
  line/arrow: width, height = vector from x,y (may be negative), stroke, strokeWidth   (x,y = start)
  polygon:   points [[x,y], ...] relative to x,y (3 to 64), fill, stroke
  group:     no extra properties; members set "parent": "<group id>" and use coordinates relative to it

SLIDE: { "caption": "<=400 chars", "changes": { "<actor-id>": { "<property>": <value> } },
         timing (NOT on the first slide): "trigger" "auto"|"next", "style" "fluid"|"direct",
         "duration" ms, "delay" ms, "easing" "linear"|"ease-in"|"ease-out"|"ease-in-out"|"back-out" }

Colours: theme tokens (preferred, they follow the IDE's light/dark theme): text, muted, accent, accent2, success,
warning, danger, surface, none. Or "#rrggbb".
</animation_format>

<hard_rules>
Enforced by the validator; breaking one rejects the animation.
- Strict JSON: double quotes, no trailing commas, no comments (a "//" key with a string value is allowed).
- The first slide has NO timing properties.
- Slides list only what changes; never change "type" or "parent"; refer only to declared actor ids.
- Only the property names listed above. No HTML, CSS, scripts or expressions.
- Stage 1000 x 600, origin top-left, y downward; keep everything within x 40..960 and y 40..560 on every slide.
- At most 200 actors and 60 slides per animation; durations and delays at most 10000 ms.
- Actors that appear later start with "visible": false and get { "visible": true } in a slide.
</hard_rules>

<symbols>
Ponder matches by EXACT string, built from the file where the function is defined. Give a primary symbol and put
other plausible forms in "aliases".
- npm:   "js:<package>#<name>"; class members "js:<package>#<Class>.<method>". If defined in a sub-file, add
         alias "js:<package>/<path without extension>#<name>".
- pypi:  "py:<defining module>.<qualified name>", e.g. numpy.clip is defined in numpy/_core/fromnumeric.py:
         "py:numpy._core.fromnumeric.clip". Add the public path as an alias ("py:numpy.clip").
- maven: "<package>.<Class>#<method>(<fully qualified erased parameter types>)", e.g.
         "com.google.common.collect.Lists#partition(java.util.List,int)". Overloads: one alias per overload you
         animate.
- crates: "rust:<crate_with_underscores>::<module path>::<item>", trait methods "...::<Trait>::<method>".
- go:    "go:<module path>/<package dir>.<Name>" (root package: "go:<module path>.<Name>").
- packagist: no language prefix; use the sym: form below as the primary symbol.
- Every non-maven animation ALSO gets alias "sym:<defining file path inside the package>:<enclosing names joined
  by .>", e.g. "sym:chunk.js:chunk", "sym:Arr.php:Arr.flatten".
  The path is relative to the INSTALLED package root: the folder holding package.json / Cargo.toml / go.mod /
  composer.json, and for Python the top-level package folder itself (site-packages/numpy/), so numpy paths start
  at "_core/...", not "numpy/_core/...". Python packages that ship .pyi stubs: add the .pyi form too
  ("sym:_core/fromnumeric.pyi:clip"), because editors often jump to the stub.
</symbols>

<design>
- 4 to 8 slides. Slide 1: the call with concrete inputs. Middle: the steps the function really performs, in order.
  Last: the result, e.g. "chunk([1,2,3,4,5], 2) = [[1,2],[3,4],[5]]".
- A title text actor at the top (y about 60, fontSize 30 to 34) showing the call.
- Captions: one or two short sentences a beginner understands, using the example values.
- Colour meaning: accent = data being processed, success = result, warning = limits/boundaries,
  danger = rejected or out-of-range values, muted = axes, labels, scaffolding.
- Values move with "fluid" transitions so the eye can follow them; "direct" only for jumps.
- fontSize 20 to 34; nothing overlaps on any slide.
- Animation ids: lower-case words with dashes, e.g. "chunk", "lists-partition".
</design>

<self_check>
Before output, for every animation: valid JSON; first slide without timing; only declared actors and allowed
properties; all coordinates inside the stage on every slide; every value in every caption recomputed against the
real function; symbol based on the defining file, plus the sym: alias. Fix anything that fails.
</self_check>

<output>
If you can write files, create the folder ponder-index/ exactly as in <folder_layout>.
Otherwise print each file as a heading with its path followed by one code block with the full content, e.g.
  ### ponder-index/v1/npm/lodash.json
  ```json
  { ... }
  ```
Print .nojekyll as an empty block. Finish with:
- "Skipped": functions you left out, and why.
- "Verify": every symbol you are not fully sure of.
</output>
````

## After it is generated

1. Validate the folder (exit code 0 means it is ready to publish):
   ```
   node ponder.cjs check-index ponder-index
   ```
2. Confirm the symbols: in a project that uses the package, right-click a call of the function and choose
   **Copy Ponder Symbol**. If it differs from the file, add it to `aliases`.
3. Read every animation in the preview (`npm run try -- file.json` in `engine/`, using the inner `ponder` object)
   and compare its result with what the function really returns.
4. Publish: push the folder to a public GitHub repository, then Settings > Pages > Deploy from a branch > `main`,
   `/ (root)`. Full steps: [online-index.md](online-index.md#publishing-on-github-pages).
