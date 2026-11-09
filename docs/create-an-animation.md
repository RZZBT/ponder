# Create a Ponder animation

Animations are a JSON file shipped inside your library's jar.

## 1. Get the exact symbol

In the IDE, right-click the method name (its declaration or any call to it) and choose **Copy Ponder Symbol**.
You get a string like:

```
com.example.math.MathUtils#abs(int)
```

Overloads have different symbols.

## 2. Write the file

Create `src/main/resources/META-INF/ponder/ponder.json` in your library:

```json
{
  "version": 1,
  "library": { "group": "com.example", "name": "math-utils" },
  "animations": {
    "abs": {
      "symbol": "com.example.math.MathUtils#abs(int)",
      "title": "How abs() works",
      "autoAdvance": true,
      "actors": {
        "//":    "The canvas is 1000 x 600. x, y is the center of a shape.",
        "axis":  { "type": "line", "x": 150, "y": 300, "width": 700, "stroke": "muted" },
        "zero":  { "type": "text", "x": 500, "y": 350, "text": "0", "fill": "muted" },
        "dot":   { "type": "circle", "x": 290, "y": 300, "radius": 20, "fill": "danger" },
        "label": { "type": "text", "x": 500, "y": 180, "text": "abs(-6) = ?", "fontSize": 32 }
      },
      "slides": [
        { "caption": "abs(x) is the distance of x from 0. Start with x = -6." },
        { "caption": "-6 is 6 steps away from 0, so it moves to +6.",
          "duration": 900,
          "changes": { "dot": { "x": 710, "fill": "success" } } },
        { "caption": "The result is never negative: abs(-6) = 6.",
          "changes": { "label": { "text": "abs(-6) = 6", "fill": "success" } } }
      ]
    }
  }
}
```

- **actors**: the shapes on screen (`rectangle`, `circle`, `ellipse`, `line`, `arrow`, `text`, `polygon`, `group`).
  Lines and arrows start at `x`, `y`. A `group` moves its children together (give them `"parent": "<group id>"`).
- **slides**: the steps. Each slide has a caption and only the `changes` compared to the slide before it.

How slides move on:

- `"autoAdvance": true` on the animation: every slide moves on by itself after 1.5 s. Use a number for another pause,
  e.g. `"autoAdvance": 2500`. Leave it out and every slide waits for the viewer to press **Next**.
- On a single slide, `"trigger": "next"` makes that slide wait even with `autoAdvance` (a pause point), and
  `"trigger": "auto"` makes just that slide move on by itself.
- Also on a slide: `"duration": 900` (ms of movement), `"style": "direct"` (jump instead of animate),
  `"easing": "ease-out"`, and `"stagger"` + `"order"` to move several actors one after another.

`"//"` keys are comments and allowed in every object; use a list of strings for several lines.

Colors are either a theme name (`text`, `muted`, `accent`, `accent2`, `success`, `warning`, `danger`, `surface`),
which follows the IDE's light or dark theme, or a hex value like `#FF5F5F` (`#RRGGBBAA` for transparency).

`library.name` must match your package name (Maven artifactId, npm, PyPI, crate or NuGet name; add `library.group`
for Maven); Ponder refuses files that claim another library.
For real examples, from a one-liner to recursion and sorting, see the ten animations in
[examples/math-utils/.../ponder.json](../examples/math-utils/src/main/resources/META-INF/ponder/ponder.json).
Every field is listed in [ponder-format.md](ponder-format.md). Add `"$schema"` pointing to `schema/ponder.schema.json`
to get completion while you type.

## 3. Preview it while you edit

```
cd engine
npm install
npm run try -- path/to/your/META-INF/ponder/ponder.json
```

The page reloads on save. Errors show the JSON path, for example `$.animations.abs.actors.dot.radius: Expected a number but found the string "big".`

## 4. Check it

```
cd engine
npm run check -- path/to/your/library      # or the built jar
```

This confirms that every `symbol` names a real function in your package and that IDEs will find the file. See
[compatibility.md](compatibility.md).

## 5. Ship it

Gradle and Maven copy `src/main/resources` into the jar, so `META-INF/ponder/ponder.json` is packaged automatically.

Maven also adds `META-INF/maven/<group>/<artifact>/pom.properties`, which lets Ponder confirm the file really belongs
to your library. Gradle does not; copy the small `pomProperties` task from
[examples/math-utils/build.gradle.kts](../examples/math-utils/build.gradle.kts) to add it. Without it, Ponder falls
back to checking the library name.

## 6. Try it in the IDE

With the demo: add your method to `examples/math-utils`, run `./gradlew :examples:math-utils:syncDemoJar`, start
the sandbox IDE (`run-ide.cmd` or `./gradlew :plugin:runIde`) and press Alt+W on a call. If nothing shows, the hint
says why; **Tools | Ponder: Show Diagnostics** lists problems in library files.
