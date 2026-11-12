# Prompt: write a Ponder index file with an AI assistant

Copy everything inside the box below into an AI assistant. Fill in the four `{{...}}` fields first, and paste the
real source code of the functions. Without the source, the assistant guesses behaviour and symbol names, and both
must be exact.

Afterwards, **always** run `ponder check-index` and test the animation in an IDE (see the end of this page).

---

````text
<role>
You write animation files for Ponder, an IDE plugin that shows a short, step-by-step animation of how a library
function works. Your output is published in a public index and shown to beginners, so it must be correct, simple and
valid JSON that passes a strict validator. Accuracy matters more than visual flair.
</role>

<task>
Write ONE Ponder index file for the package below, with one animation per listed function.
- Ecosystem: {{ECOSYSTEM: npm | pypi | maven | crates | go | packagist | nuget}}
- Package name: {{PACKAGE NAME, exactly as on the registry, e.g. lodash, scikit-learn, com.google.guava:guava}}
- Versions this applies to: {{VERSION RANGE, e.g. ">=4.17 <5", or "all"}}
- Functions to animate: {{LIST, e.g. chunk, clamp, debounce}}
</task>

<source_code>
{{PASTE the source of each function, with its file path inside the package, e.g. "lodash/chunk.js".
For Python include the module path, e.g. "numpy/_core/fromnumeric.py". For Java include the package and class.}}
</source_code>

<grounding_rules>
1. Describe only behaviour you can see in <source_code> or that the package's official documentation states. If you
   are unsure how an edge case behaves, leave it out of the animation; do not guess.
2. Use concrete example values (e.g. chunk([1,2,3,4,5], 2)) and make sure every result you show is what the real
   function returns for those inputs. Work the example out step by step before writing it into a caption.
3. If a function cannot be animated honestly (too abstract, side effects only, behaviour not in the source), skip it
   and say so in the notes. Fewer correct animations are better than many wrong ones.
</grounding_rules>

<file_format>
The output is an index file:

{
  "ponderIndex": 1,
  "ecosystem": "<ecosystem>",
  "name": "<package name>",
  "documents": [
    { "versions": "<range, omit the key entirely for all versions>", "ponder": <PONDER DOCUMENT> }
  ]
}

PONDER DOCUMENT:
{
  "version": 1,
  "library": { "name": "<package name>" },          // Maven: { "group": "<groupId>", "name": "<artifactId>" }
  "animations": { "<animation-id>": <ANIMATION>, ... }
}

ANIMATION:
{
  "symbol": "<exact symbol, see symbol_rules>",
  "aliases": ["<other spellings of the same function>"],
  "title": "How chunk() works",
  "description": "<one sentence, plain language>",
  "actors": { "<actor-id>": <ACTOR>, ... },
  "slides": [ <SLIDE>, ... ]
}

ACTOR: { "type": ..., "x": ..., "y": ..., <type properties>, optional "visible", "opacity", "rotation", "scale", "z" }
  rectangle: width, height, cornerRadius, fill, stroke, strokeWidth      (x,y = centre)
  circle:    radius, fill, stroke, strokeWidth                           (x,y = centre)
  ellipse:   width, height, fill, stroke, strokeWidth                    (x,y = centre)
  text:      text (<=500 chars), fontSize, fill, anchor ("start"|"middle"|"end")   (x,y = centre)
  line, arrow: width, height = vector from x,y (may be negative), stroke, strokeWidth   (x,y = start point)
  polygon:   points [[x,y],...] relative to x,y, 3 to 64 points, fill, stroke
  group:     no extra properties; other actors join it with "parent": "<group id>" and use relative coordinates

SLIDE: { "caption": "<= 400 chars", "changes": { "<actor-id>": { "<property>": <new value> } },
         optional timing: "trigger": "auto"|"next", "style": "fluid"|"direct", "duration": ms, "delay": ms,
         "easing": "linear"|"ease-in"|"ease-out"|"ease-in-out"|"back-out" }

Colours: "#rrggbb" or theme tokens (preferred, they adapt to light and dark IDE themes):
  text, muted, accent, accent2, success, warning, danger, surface, none
</file_format>

<hard_rules>
These are enforced by the validator. Breaking any of them rejects the animation.
- Output strict JSON: double quotes, no trailing commas, no comments except a "//" key whose value is a string.
- The FIRST slide has no timing properties (no trigger, style, duration, delay, easing). It is shown immediately.
- A slide lists only what CHANGES. Never change "type" or "parent" in a slide. Only refer to actor ids that exist.
- Every property name must be one of those listed above; no CSS, no HTML, no scripts, no expressions.
- Stage is 1000 wide x 600 tall, origin top-left, y grows downward. Keep everything inside 40..960 x 40..560.
- At most 200 actors, 60 slides, durations and delays at most 10000 ms, whole animation at most 120 s.
- "library.name" must be exactly the package name. A mismatch hides the animation.
- Actors that appear later are declared with "visible": false and switched on with { "visible": true }.
</hard_rules>

<symbol_rules>
Ponder matches the symbol by EXACT string, built from the file where the function is DECLARED (not where it is
re-exported or imported from). Write the primary symbol, then put every other plausible form in "aliases".
- npm:   "js:<package>#<name>", class members "js:<package>#<Class>.<method>". If the function is declared in a
         sub-file, also add "js:<package>/<file path without extension>#<name>".
- pypi:  "py:<declaring module path>.<qualified name>", e.g. numpy.clip is declared in numpy/_core/fromnumeric.py,
         so "py:numpy._core.fromnumeric.clip". Class methods: "py:pkg.module.Class.method".
- maven: "<package>.<Class>#<method>(<fully qualified erased parameter types>)", e.g.
         "com.google.common.base.Strings#padStart(java.lang.String,int,char)"; constructors use "#<init>(...)".
- crates: "rust:<crate_with_underscores>::<module path>::<name>".
- go:    "go:<module path>/<package dir>.<Name>".
- packagist (PHP) and any other language: there is no language prefix; the primary symbol IS the "sym:" form
         below, e.g. "sym:Arr.php:Arr.flatten".
- Except for maven, ALSO add a fallback alias "sym:<declaring file path inside the package>:<enclosing names joined
  by .>", e.g. "sym:chunk.js:chunk" or "sym:_core/fromnumeric.py:clip". IDEs that cannot build the
  language-specific form still find this one.
  The path is relative to the INSTALLED package root: the folder holding package.json / Cargo.toml / go.mod /
  composer.json, and for Python the top-level package folder itself (site-packages/numpy/), so numpy paths start
  at "_core/...", not "numpy/_core/...". Python packages that ship .pyi stubs: add the .pyi form too
  ("sym:_core/fromnumeric.pyi:clip"), because editors often jump to the stub.
</symbol_rules>

<design_rules>
- 4 to 8 slides. Slide 1 sets up the call with concrete input values. The middle slides show the steps the function
  really performs. The last slide shows the result, e.g. "chunk([1,2,3,4,5], 2) = [[1,2],[3,4],[5]]".
- Captions: one or two short sentences for a beginner. Say what happens and why, using the example values.
- Show a title text actor at the top (y about 60, fontSize 30 to 34) with the call being explained.
- Use colour with meaning: accent for the data being worked on, success for results, warning for limits and
  boundaries, danger for values that are rejected or out of range, muted for scaffolding (axes, labels).
- Prefer "fluid" movement so the viewer can follow where values go; use "style": "direct" only for jumps.
- Text sizes 20 to 34. Leave space between elements so nothing overlaps on any slide.
</design_rules>

<example>
A minimal valid index file, for reference of the shape only (do not copy its content):
{
  "ponderIndex": 1, "ecosystem": "npm", "name": "math-utils",
  "documents": [ { "versions": ">=1.0 <2", "ponder": {
    "version": 1,
    "library": { "name": "math-utils" },
    "animations": {
      "clamp": {
        "symbol": "js:math-utils#clamp",
        "aliases": ["sym:index.js:clamp"],
        "title": "How clamp() works",
        "description": "Keeps a number inside a range.",
        "actors": {
          "title": { "type": "text", "x": 500, "y": 60, "text": "clamp(-4, 0, 10)", "fontSize": 32 },
          "axis":  { "type": "line", "x": 100, "y": 320, "width": 800, "height": 0, "stroke": "muted", "strokeWidth": 3 },
          "min":   { "type": "line", "x": 300, "y": 260, "width": 0, "height": 120, "stroke": "warning", "strokeWidth": 4 },
          "value": { "type": "circle", "x": 160, "y": 320, "radius": 24, "fill": "danger" },
          "label": { "type": "text", "x": 160, "y": 250, "text": "-4", "fontSize": 26 }
        },
        "slides": [
          { "caption": "The value -4 is below the minimum 0." },
          { "caption": "clamp() moves it up to the minimum, so the result is 0.", "duration": 900,
            "changes": { "value": { "x": 300, "fill": "success" }, "label": { "x": 300, "text": "0" } } }
        ]
      }
    }
  } } ]
}
</example>

<before_you_answer>
Check silently, then fix anything that fails:
1. Is it valid JSON? Does every slide refer only to declared actors and allowed properties?
2. Does the first slide have no timing? Is every coordinate inside the stage?
3. Recompute each example: is every value in every caption what the real function returns?
4. Does each animation have a primary symbol plus a "sym:" alias that names the declaring file?
</before_you_answer>

<output_format>
1. The complete index file in ONE ```json code block, nothing else inside the block.
2. Then a short "Notes" list: the file path to save it as (v1/<ecosystem>/<canonical name>.json, lower case for npm
   and PyPI, PyPI with "-" for "_" and "."), any function you skipped and why, and every symbol you are not sure of.
</output_format>
````

---

## After the assistant answers

1. Save the JSON at the path it gave, e.g. `ponder-index/v1/npm/lodash.json`.
2. Validate the whole index:
   ```
   node ponder.cjs check-index ponder-index
   ```
3. Check that the symbols name real functions: save the inner `ponder` object as `ponder.json` in the installed
   package folder (for example `node_modules/lodash/ponder.json`), then run `node ponder.cjs check node_modules/lodash`.
   Delete that copy afterwards.
4. Get the true symbol from the IDE: open a project that uses the package, right-click a call of the function and
   choose **Copy Ponder Symbol**. If it differs from the file, add it to `aliases`. This is the only fully reliable
   test, because it is exactly what the IDE will look for. For npm packages whose types come from `@types/...`, the
   IDE may resolve to the `@types` package; then the file belongs under that package's name.
5. Preview it: `npm run try -- path/to/ponder.json` (in `engine/`), and check every caption against the real
   function's output.
