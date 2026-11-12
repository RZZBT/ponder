# Changelog

## 0.3.0

- **Built-in functions**: Alt+W on `sorted`, `str.split`, `Array.map`, `Math.max`, `Vec::push`, `strings.Split` and
  other functions of the language itself now looks for an animation too (Python, JavaScript/TypeScript, Rust, Go).
- **Friendly problems**: when there is no animation, Ponder says what happened, why, and what to try, with buttons
  for the fixes: install the missing language extension, trust the folder, install a missing library, select the
  Python interpreter, turn on online lookups, retry, update Ponder. "How to fix…" opens a page with every step.
- No more 15-second wait when a language extension is missing.
- "No animation yet" from the community index is checked again after an hour, so new animations appear quickly.
- Animations that need a newer Ponder now say so, with an "Update Ponder" button.

## 0.2.1

- Store page, icon and links.

## 0.2.0

First public release.

- Press Alt+W on a library call to see a step-by-step animation of the function.
- Animations from the library itself, from `.ponder` folders in your project, or from the free community index
  (asks once before going online; only the package name is sent; works offline afterwards).
- Shows where each animation came from.
- Clear message and a *Trust Folder…* button in Restricted Mode.
- Copy Ponder Symbol, for library authors writing their own animations.
- Follows the light/dark theme and the system's reduced-motion setting.
