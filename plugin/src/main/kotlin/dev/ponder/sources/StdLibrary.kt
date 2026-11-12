package dev.ponder.sources

/**
 * Recognises declarations in a language's standard library from the file the IDE resolved to (Ponder 0.3). Kotlin
 * port of engine/src/sources/stdlib.ts; both run schema/conformance/stdlib.json, so keep them in step.
 *
 *   …/typeshed/stdlib/builtins.pyi + [str, split]  -> std python/builtins, py:builtins.str.split
 *   …/rustlib/src/rust/library/alloc/src/vec/mod.rs + [Vec, push] -> std rust/alloc.vec
 *   GOROOT/src/strings/strings.go + [Split]       -> std go/strings, go:strings.Split
 *
 * Java's standard library (the JDK) is recognised from the project's SDK, see [forJdk]. Pure; never throws.
 */
object StdLibrary {

    data class Declaration(
        val language: String,
        /** Module as used in the index name: `builtins`, `os.path`, `Array`, `alloc.vec`, `net/http`, `java.util`. */
        val module: String,
        /** Language version when known (`3.12`, `1.98.1`, `21.0.2`), else null. */
        val version: String?,
        /** The standard library's root folder, `/`-separated. */
        val root: String,
        /** Symbol strings, most specific first. */
        val candidates: List<String>,
    ) {
        /** Index key name: `<language>/<module>`. */
        val keyName: String get() = "$language/$module"
    }

    private val IDENT = Regex("^[A-Za-z_$][A-Za-z0-9_$]*$")
    private val PY_PART = Regex("^[A-Za-z_][A-Za-z0-9_]*$")
    private val RUST_PART = Regex("^[a-z_][a-z0-9_]*$")

    private fun norm(p: String) = p.replace('\\', '/').trimEnd('/')

    /** [names] are the enclosing names of the declaration, outermost first: `["str", "split"]`. */
    fun recognize(path: String, names: List<String>): Declaration? = try {
        if (names.isEmpty() || names.size > 8 || names.any { !IDENT.matches(it) }) null
        else {
            val p = norm(path)
            python(p, names) ?: javascript(p, names) ?: rust(p, names) ?: go(p, names)
        }
    } catch (e: Exception) {
        null
    }

    /**
     * A JDK class: [packageName] `java.util`, candidates are the JVM signature the resolver built.
     * [jdkVersionString] is the SDK's version text, e.g. `21.0.2` or `java version "17.0.9"`.
     */
    fun forJdk(packageName: String, candidates: List<String>, jdkVersionString: String?): Declaration? {
        if (packageName.isEmpty() || candidates.isEmpty()) return null
        val version = jdkVersionString?.let { Regex("(\\d+(?:\\.\\d+)*)").find(it)?.value }
        return make("java", packageName, version, "", candidates)
    }

    private fun make(language: String, module: String, version: String?, root: String, candidates: List<String>): Declaration? {
        val rule = IndexProtocol.STD_LANGUAGES[language] ?: return null
        if (!rule.module.matches(module)) return null
        return Declaration(language, module, version, root, candidates)
    }

    // ------------------------------------------------------------------ Python

    private fun pythonModule(rel: String): String? {
        val parts = rel.replace(Regex("\\.pyi?$"), "").split('/').toMutableList()
        if (parts.firstOrNull()?.firstOrNull()?.isDigit() == true) parts.removeAt(0) // older Jedi: stdlib/3/…
        if (parts.lastOrNull() == "__init__") parts.removeAt(parts.size - 1)
        if (parts.isEmpty() || parts.any { !PY_PART.matches(it) }) return null
        return parts.joinToString(".")
    }

    private fun python(p: String, names: List<String>): Declaration? {
        var root: String? = null
        var rel = ""
        var version: String? = null
        val stub = Regex("^(.*/typeshed(?:-fallback)?/stdlib)/(.+\\.pyi)$").find(p)
        if (stub != null) { root = stub.groupValues[1]; rel = stub.groupValues[2] }
        val posix = if (stub == null) Regex("^(.*/lib/python(3\\.\\d+))/(.+\\.py)$").find(p) else null
        if (posix != null) { root = posix.groupValues[1]; version = posix.groupValues[2]; rel = posix.groupValues[3] }
        val win = if (stub == null && posix == null) Regex("^(.*/(?:python|pythoncore-)3[.-]?(\\d+)[^/]*/Lib)/(.+\\.py)$", RegexOption.IGNORE_CASE).find(p) else null
        if (win != null) { root = win.groupValues[1]; version = "3.${win.groupValues[2]}"; rel = win.groupValues[3] }
        if (root == null) return null
        val first = rel.substringBefore('/')
        if (first in setOf("site-packages", "dist-packages", "test", "tests", "idlelib", "lib2to3") || first.startsWith("@")) return null
        val module = pythonModule(rel) ?: return null
        val joined = names.joinToString(".")
        return make("python", module, version, root, listOf("py:$module.$joined", "sym:$rel:$joined"))
    }

    // ------------------------------------------------------------------ JavaScript / TypeScript

    private fun javascript(p: String, names: List<String>): Declaration? {
        val m = Regex("^(.*/typescript/lib)/(lib\\.[A-Za-z0-9.]+\\.d\\.ts)$").find(p) ?: return null
        val first = names.first()
        val rest = names.drop(1)
        val module = if (rest.isEmpty()) "globals" else first.removeSuffix("Constructor").ifEmpty { first }
        val joined = names.joinToString(".")
        val candidates = mutableListOf("js:std#$joined")
        if (rest.isNotEmpty() && module != first) candidates += "js:std#$module.${rest.joinToString(".")}"
        candidates += "sym:${m.groupValues[2]}:$joined"
        return make("javascript", module, null, m.groupValues[1], candidates)
    }

    // ------------------------------------------------------------------ Rust

    private fun rust(p: String, names: List<String>): Declaration? {
        val m = Regex("^(.*/rustlib/src/rust/library/(core|alloc|std|proc_macro|test))/src/(.+)\\.rs$").find(p) ?: return null
        val crate = m.groupValues[2]
        val mods = m.groupValues[3].split('/').toMutableList()
        if (mods.any { !RUST_PART.matches(it) }) return null
        if (mods.last() in setOf("lib", "mod", "main")) mods.removeAt(mods.size - 1)
        val module = if (mods.isNotEmpty()) "$crate.${mods.first()}" else crate
        val version = Regex("/toolchains/(\\d+\\.\\d+\\.\\d+)(?:[-/]|$)").find(p)?.groupValues?.get(1)
        return make("rust", module, version, m.groupValues[1], listOf(
            "rust:" + (listOf(crate) + mods + names).joinToString("::"),
            "sym:src/${m.groupValues[3]}.rs:${names.joinToString(".")}",
        ))
    }

    // ------------------------------------------------------------------ Go

    private val GO = Regex(
        "^(.*/(?:go|go(\\d+(?:\\.\\d+)*)|golang\\.org/toolchain@v[^/]*?-go(\\d+(?:\\.\\d+)*)[^/]*))/src/((?:[^/]+/)*)([^/]+)\\.go$",
        RegexOption.IGNORE_CASE,
    )

    private fun go(p: String, names: List<String>): Declaration? {
        val m = GO.find(p) ?: return null
        val pkg = m.groupValues[4].trimEnd('/')
        val file = m.groupValues[5]
        if (pkg.isEmpty() || file.endsWith("_test")) return null
        val parts = pkg.split('/')
        if (parts[0].contains('.') || parts[0] in setOf("cmd", "vendor") || "testdata" in parts || "vendor" in parts) return null
        val version = m.groupValues[2].ifEmpty { m.groupValues[3] }.ifEmpty { null }
        val joined = names.joinToString(".")
        return make("go", pkg, version, m.groupValues[1], listOf("go:$pkg.$joined", "sym:src/$pkg/$file.go:$joined"))
    }

    /** Go's `VERSION` file in GOROOT starts with `go1.22.3`. */
    fun goVersionFromFile(text: String): String? = Regex("^go(\\d+(?:\\.\\d+)*)").find(text.trim())?.groupValues?.get(1)
}
