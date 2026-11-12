# Prompts: fill the index with popular functions

Three prompts, used in order. Asking one prompt for dozens of animations at once gives shallow and often wrong
results; planning, writing and reviewing separately gives far better ones.

1. **Plan**: pick popular packages and the functions worth animating.
2. **Write**: one package at a time, with [index-authoring-prompt.md](index-authoring-prompt.md).
3. **Review**: a second assistant checks each animation against the source.

**What the index can cover.** Ponder looks up identified third-party packages only:

| Ecosystem | Example packages |
|---|---|
| npm | lodash, date-fns |
| PyPI | numpy, more-itertools |
| Maven | guava, commons-lang3 |
| crates | itertools |
| Go | github.com/samber/lo |
| Packagist | illuminate/collections |

Standard libraries (Python's `sorted`, JavaScript's `Array.prototype.map`, Java's `Math.abs`) are never looked up
online, and NuGet packages are not identified by the clients yet.

---

## Prompt 1: plan

````text
<role>
You are planning content for Ponder, an IDE plugin that shows beginners a short animation of how a library function
works. Animations are published in a public index, one file per package.
</role>

<task>
Propose packages and functions to animate first, for these ecosystems: {{e.g. npm, pypi, maven, crates, go,
packagist}}. Aim for {{N, e.g. 3}} packages per ecosystem and 3 to 6 functions per package.
</task>

<constraints>
- Third-party packages only, published on the ecosystem's registry. NO standard-library functions (e.g. no Python
  builtins, no JavaScript Array methods, no java.lang / java.util, no Rust std, no Go standard library).
- Prefer packages that are very widely used AND whose functions transform data in a way that can be drawn:
  splitting, grouping, sorting, searching, clamping, padding, windowing, merging, date arithmetic, string shaping.
- Avoid functions whose behaviour is mainly I/O, networking, configuration, side effects, or depends on time or
  randomness. Avoid functions with many options where a short animation would mislead.
- Prefer stable functions that have existed unchanged for several major versions.
- Do not invent package or function names. If you are not certain a function exists with that exact name in the
  current version, mark it "unsure".
</constraints>

<output_format>
A JSON array, nothing else:
[
  {
    "ecosystem": "npm",
    "package": "lodash",
    "versions": ">=4 <5",
    "functions": [
      { "name": "chunk", "why": "splits an array into groups; easy to draw",
        "example": "chunk([1,2,3,4,5], 2) -> [[1,2],[3,4],[5]]",
        "declared_in": "<file path inside the package where it is defined, or \"unsure\">",
        "confidence": "sure | unsure" }
    ]
  }
]
For "declared_in", give the file where the function is DEFINED, not where it is re-exported. Maven packages: give
the fully qualified class and the parameter types instead of a file.
</output_format>
````

**Then, by hand:** remove anything marked `unsure` that you cannot confirm, and look up each `declared_in` file in
the installed package. You need that source for prompt 2.

---

## Prompt 2: write

Use [index-authoring-prompt.md](index-authoring-prompt.md) once per package. Fill its fields from the plan:

| Field | From the plan |
|---|---|
| `ECOSYSTEM`, `PACKAGE NAME`, `VERSION RANGE` | `ecosystem`, `package`, `versions` |
| `Functions to animate` | the `name`s, with the `example` of each as a hint |
| `source_code` | the real source of each function, copied from the installed package, with its file path |

Then run `ponder check-index` and `ponder check` as described at the end of that page.

---

## Prompt 3: review

Use a fresh conversation (or a different assistant), so the reviewer does not share the writer's mistakes.

````text
<role>
You are a strict reviewer of Ponder animations. Each animation teaches beginners what a library function does. A
wrong animation is worse than none, because beginners will trust it.
</role>

<inputs>
<function_source>
{{PASTE the real source of the function, with its file path}}
</function_source>
<animation>
{{PASTE one animation object from the index file: symbol, title, actors, slides}}
</animation>
</inputs>

<task>
Check the animation against the source. Work through these in order and quote the slide caption you are judging:
1. Correctness: for the example values used, compute what the real function returns, step by step, from the
   source. Does every caption and the final result match exactly? Are intermediate steps ones the function really
   performs, in that order?
2. Misleading simplifications: does any slide suggest behaviour the function does not have (e.g. mutating the input
   when it returns a copy, or the wrong treatment of edge cases it shows)?
3. Symbol: given the file path, is the "symbol" plausible for where the function is declared? Is there a "sym:"
   alias naming that file (not needed for Maven)?
4. Clarity for a beginner: is every caption short, concrete and free of jargon that is not explained?
5. Layout: do any actors overlap or leave the 1000 x 600 stage on any slide?
</task>

<output_format>
VERDICT: PASS, FIX or REJECT
Then a numbered list of problems, each with the slide index, what is wrong, and the exact corrected caption or
JSON change. If the verdict is PASS, write "No problems found" and nothing else.
</output_format>
````

Apply the fixes, run `ponder check-index` again, and preview the animation before publishing.

---

## A starting list

Widely used packages with functions that animate well. Confirm every name and file against the installed version
before writing; this list is a suggestion, not checked against current releases.

| Ecosystem | Package | Functions |
|---|---|---|
| npm | `lodash` | `chunk`, `groupBy`, `uniq`, `debounce`, `flatten` |
| npm | `date-fns` | `addDays`, `differenceInDays`, `startOfWeek` |
| PyPI | `numpy` | `clip`, `argsort`, `cumsum`, `reshape` |
| PyPI | `more-itertools` | `chunked`, `windowed`, `flatten` |
| Maven | `com.google.guava:guava` | `Lists.partition`, `Strings.padStart`, `Ints.constrainToRange` |
| Maven | `org.apache.commons:commons-lang3` | `StringUtils.abbreviate`, `StringUtils.center`, `ArrayUtils.reverse` |
| crates | `itertools` | `interleave`, `dedup`, `chunks` |
| Go | `github.com/samber/lo` | `Chunk`, `Uniq`, `GroupBy` |
| Packagist | `illuminate/collections` | `Arr::flatten`, `Collection::chunk`, `Collection::groupBy` |
