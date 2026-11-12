package dev.ponder.matching

/**
 * Something that stopped Ponder from showing an animation, in words a beginner can act on: what happened, why, and
 * what to try, with buttons for the steps the IDE can do. Pure data; shown by PonderActivation. The VS Code
 * extension has the same catalogue (vscode/src/problems.ts); keep the wording close.
 */
data class PonderProblem(
    val id: String,
    /** One line, no final period. */
    val title: String,
    /** What happened and why. */
    val detail: String,
    /** What to try, most likely fix first. */
    val tries: List<String>,
    val actions: List<Action> = emptyList(),
    /** Something on this computer stops Ponder (shown as a warning), rather than "nothing written yet". */
    val setup: Boolean = false,
) {
    enum class Action(val label: String) {
        PROJECT_STRUCTURE("Open Project Structure"),
        PYTHON_INTERPRETER("Python Interpreter settings"),
        PONDER_SETTINGS("Ponder settings"),
        ENABLE_ONLINE("Turn on online lookups"),
        RETRY_ONLINE("Retry now"),
        PLUGINS("Update Ponder"),
        DIAGNOSTICS("Show diagnostics"),
    }

    /** For logs: every step. */
    val longText: String
        get() = buildString {
            append("── ").append(title).append(" ──\n").append(detail).append("\nTry:\n")
            tries.forEachIndexed { i, t -> append("  ").append(i + 1).append(". ").append(t).append('\n') }
        }
}

object PonderProblems {
    fun noName() = PonderProblem(
        "no-name", "Put the caret on a function name",
        "Ponder explains functions and methods. The caret is on a space, a keyword or something that is not a name.",
        listOf(
            "Click inside a function name, for example on `abs` in `Math.abs(-3)` or on `sorted` in `sorted(numbers)`.",
            "Then press Alt+W again, or right-click the name and choose Open Ponder.",
        ),
    )

    fun noJdk() = PonderProblem(
        "no-jdk", "This project has no JDK",
        "Without a JDK the IDE cannot understand Java or Kotlin code, so it cannot tell Ponder where a method is defined.",
        listOf(
            "Open File | Project Structure | Project and choose an SDK (or download one there; any recent JDK works).",
            "Wait for indexing to finish (progress at the bottom of the window), then press Alt+W again.",
        ),
        listOf(PonderProblem.Action.PROJECT_STRUCTURE), setup = true,
    )

    fun cannotResolve(name: String, language: String) = PonderProblem(
        "cannot-resolve", "The IDE can't find where '$name' is defined",
        "Ponder needs the definition to know which library a function belongs to. '$name' is shown in red or is not recognised yet.",
        when (language) {
            "python" -> listOf(
                "Install the package into the interpreter this project uses: `python -m pip install <package>` in the Terminal, or Settings | Project | Python Interpreter | +.",
                "Already installed? Check that the project uses that interpreter (Settings | Project | Python Interpreter).",
                "Wait for indexing to finish, then press Alt+W again.",
            )
            "jvm" -> listOf(
                "Check that the library is a dependency of this module (build.gradle, pom.xml) and reload the project (Gradle or Maven tool window, Reload).",
                "Check the spelling and the import; the IDE has to understand the code before Ponder can.",
                "Wait for indexing to finish, then press Alt+W again.",
            )
            else -> listOf(
                "Make sure the library is installed for this project (npm install, cargo add, go get, composer require, ...).",
                "Check the spelling and the import; the IDE has to understand the code before Ponder can.",
                "Wait for indexing to finish, then press Alt+W again.",
            )
        },
        if (language == "python") listOf(PonderProblem.Action.PYTHON_INTERPRETER) else emptyList(), setup = true,
    )

    fun callHasErrors(name: String) = PonderProblem(
        "call-has-errors", "The call to '$name' has errors",
        "The IDE cannot tell which '$name' is meant, usually because the arguments do not match any version of it.",
        listOf(
            "Fix the red or underlined parts of the call first (hover over them for the IDE's explanation).",
            "Then press Alt+W again.",
        ),
    )

    fun notAFunction(name: String) = PonderProblem(
        "not-a-function", "'$name' is not a function",
        "Ponder animations explain functions, methods and constructors, not variables, fields or types.",
        listOf("Put the caret on a call, for example on `add` in `list.add(x)`, then press Alt+W."),
    )

    fun ownCode(name: String) = PonderProblem(
        "own-code", "'$name' is your own code",
        "Ponder explains functions of libraries and of the language itself. This one is defined in your project.",
        listOf(
            "Try Alt+W on a library or built-in call, for example `Math.max(a, b)`, `sorted(...)` or `list.add(x)`.",
            "Writing a library? Add animations for your own functions: right-click a function | Copy Ponder Symbol, then see the guide \"Create an animation\".",
        ),
    )

    fun unsupportedFile() = PonderProblem(
        "unsupported-file", "Ponder can't read this kind of file",
        "This file type has no language support in the IDE that Ponder can use.",
        listOf("Try Alt+W in a source file of a supported language (Java, Kotlin, Python, JavaScript, TypeScript, Rust, Go, ...)."),
    )

    fun unknownLibrary(name: String, library: String) = PonderProblem(
        "unknown-library", "No animation for '$name'",
        "$library has no ponder.json of its own, and Ponder cannot tell its name and version for sure, so it cannot look it up anywhere else.",
        listOf(
            "Try another function: libraries added through Gradle, Maven, pip, npm, cargo or go are recognised best.",
            "Is this your library? Ship a ponder.json with it (see the guide \"Create an animation\").",
        ),
    )

    fun noAnimationYet(name: String, where: String) = PonderProblem(
        "no-animation-yet", "No animation for '$name' yet",
        "Nobody has written a Ponder animation for $name in $where so far.",
        listOf(
            "Try another function: popular ones are being added to the community index all the time.",
            "Know this function well? Write an animation for it in a `.ponder` folder in your project; Ponder uses it right away.",
            "Is this your library? Ship a ponder.json with it and every user gets the animation.",
        ),
    )

    fun onlineOff(name: String, where: String) = PonderProblem(
        "online-off", "No animation for '$name' on this computer",
        "${where.replaceFirstChar { it.uppercase() }} has no animation of its own, and online lookups are turned off, so Ponder did not check the free community index.",
        listOf(
            "Turn online lookups on: only the library's name is sent (for example \"pypi/numpy\"), never your code.",
            "Prefer to stay offline? Put animations you made or downloaded in a `.ponder` folder in your project.",
        ),
        listOf(PonderProblem.Action.ENABLE_ONLINE),
    )

    fun onlineSkipped(name: String) = PonderProblem(
        "online-skipped", "No animation for '$name' yet",
        "Ponder asked whether to check the community index, and it was not allowed this time.",
        listOf("Turn online lookups on to check the index every time (Settings | Tools | Ponder), then press Alt+W again."),
        listOf(PonderProblem.Action.ENABLE_ONLINE),
    )

    fun indexUnreachable(name: String, why: String) = PonderProblem(
        "index-unreachable", "Couldn't reach the community index",
        "Ponder tried to look up an animation for '$name', but $why. Animations downloaded before keep working offline.",
        listOf(
            "Check your internet connection, then click Retry now.",
            "On a company or school network, a proxy may be needed: Settings | Appearance & Behavior | System Settings | HTTP Proxy.",
            "Otherwise Ponder simply tries again by itself in 15 minutes.",
        ),
        listOf(PonderProblem.Action.RETRY_ONLINE), setup = true,
    )

    fun brokenLibraryFile(library: String, error: String) = PonderProblem(
        "broken-library-file", "$library's animation file has a mistake",
        "The library ships a ponder.json, but it cannot be used: $error",
        listOf(
            "You maintain this library? Run `ponder check` on the file: it shows the exact place and suggests the fix.",
            "Otherwise let the library's authors know. Animations from the community index still work meanwhile.",
        ),
        listOf(PonderProblem.Action.DIAGNOSTICS),
    )

    fun libraryMismatch(detail: String) = PonderProblem(
        "library-mismatch", "The animation file belongs to another library",
        detail,
        listOf(
            "You maintain this library? Make `library` in ponder.json name this library exactly (its artifact id or package name).",
            "Otherwise let the library's authors know; Tools | Ponder: Show Diagnostics has the details.",
        ),
        listOf(PonderProblem.Action.DIAGNOSTICS),
    )

    fun needsUpdate(message: String) = PonderProblem(
        "needs-update", "This animation needs a newer Ponder",
        message,
        listOf(
            "Update Ponder: Settings | Plugins | Installed | Ponder | Update. Updates are free and keep your settings.",
            "Then press Alt+W again.",
        ),
        listOf(PonderProblem.Action.PLUGINS), setup = true,
    )

    fun unexpected() = PonderProblem(
        "unexpected", "Ponder could not look this up",
        "Something unexpected went wrong. Your code is fine and nothing was changed.",
        listOf(
            "Press Alt+W again; most of these go away on a second try.",
            "If it keeps happening, Help | Show Log in Explorer has the details (search for \"Ponder\"); please include them when you report it.",
        ),
    )
}
