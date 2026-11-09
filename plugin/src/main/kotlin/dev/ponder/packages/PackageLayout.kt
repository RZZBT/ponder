package dev.ponder.packages

/**
 * Package detection and symbol candidates for source-distributed languages. Pure logic over [Dir]; the IDE plugin
 * adapts VirtualFile, the VS Code extension has a TypeScript port (vscode/src/packages.ts). Keep the two in step.
 */
object PackageLayout {
    const val PONDER_FILE = "ponder.json"
    const val PONDER_RESOURCE = "META-INF/ponder/ponder.json"
    private const val MAX_LEVELS = 32

    /** Files that mark the root of a package. Walking up never goes past one. */
    val MANIFESTS = listOf(
        "package.json", "Cargo.toml", "go.mod", "pyproject.toml", "setup.py", "setup.cfg", "composer.json",
        "pom.xml", "build.gradle", "build.gradle.kts", "Package.swift", "pubspec.yaml", "mix.exs", "Gemfile",
    )

    /** Folders that hold many packages: a package never extends above one of their children. */
    private val CONTAINERS = setOf("node_modules", "site-packages", "dist-packages", "vendor", "registry", "packages")

    interface Dir {
        val name: String
        val parent: Dir?
        fun hasFile(name: String): Boolean
        fun hasFileMatching(suffix: String): Boolean = false
        fun readText(name: String): String?
    }

    class Root(val dir: Dir, val ponderFile: String?, val manifest: String?)

    /** The package folder that contains a declaration in [start] (the declaration file's folder). */
    fun findRoot(start: Dir): Root {
        var dir: Dir? = start
        var levels = 0
        while (dir != null && levels++ < MAX_LEVELS) {
            val ponder = when {
                dir.hasFile(PONDER_FILE) -> PONDER_FILE
                dir.hasFile(PONDER_RESOURCE) -> PONDER_RESOURCE
                else -> null
            }
            val manifest = MANIFESTS.firstOrNull { dir.hasFile(it) }
                ?: if (dir.hasFileMatching(".gemspec") || dir.hasFileMatching(".csproj")) "" else null
            if (ponder != null || manifest != null) return Root(dir, ponder, manifest?.ifEmpty { null })
            val parent = dir.parent
            val isTopPythonPackage = dir.hasFile("__init__.py") && parent?.hasFile("__init__.py") != true
            if (isTopPythonPackage || parent == null || parent.name in CONTAINERS) return Root(dir, null, null)
            dir = parent
        }
        return Root(start, null, null)
    }

    /** Name declared by the package manifest, if there is one. */
    fun manifestName(root: Root): String? {
        val m = root.manifest ?: return null
        val text = root.dir.readText(m) ?: return null
        return when (m) {
            "package.json", "composer.json" -> Regex(""""name"\s*:\s*"([^"]+)"""").find(text)?.groupValues?.get(1)
            "Cargo.toml", "pyproject.toml" -> tomlName(text)
            "go.mod" -> Regex("""(?m)^module\s+(\S+)""").find(text)?.groupValues?.get(1)
            "setup.cfg" -> Regex("""(?m)^name\s*=\s*(\S+)""").find(text)?.groupValues?.get(1)
            else -> null
        }
    }

    private fun tomlName(text: String): String? {
        var section = ""
        for (line in text.lineSequence()) {
            val t = line.trim()
            if (t.startsWith("[")) section = t
            else if (section == "[package]" || section == "[project]" || section == "[tool.poetry]") {
                Regex("""^name\s*=\s*["']([^"']+)["']""").find(t)?.let { return it.groupValues[1] }
            }
        }
        return null
    }

    private val GO_METHOD = Regex("""^func\s*\(\s*(?:[A-Za-z_]\w*\s+)?\*?([A-Za-z_]\w*)""")
    private val RUST_IMPL = Regex("""^impl(?:<[^>]*>)?\s+(?:[^{]+?\s+for\s+)?([A-Za-z_]\w*)""")

    /** The receiver type of a Go method declaration: `func (s *IntStack) Push(v int)` gives `IntStack`. */
    fun goReceiver(declarationText: String): String? = GO_METHOD.find(declarationText.trimStart())?.groupValues?.get(1)

    /** The type of a Rust impl block: `impl IntStack {` and `impl Display for IntStack {` give `IntStack`. */
    fun implType(blockText: String): String? = RUST_IMPL.find(blockText.trimStart())?.groupValues?.get(1)

    /** Package names compare case-insensitively, with `-`, `_` and `.` treated alike (PyPI, crates). */
    fun sameName(a: String, b: String): Boolean = normalizeName(a) == normalizeName(b)

    private fun normalizeName(s: String) = s.lowercase().replace(Regex("[-_.]+"), "-")

    /**
     * Every symbol string that identifies a declaration at [relPath] (relative to the package root, `/`-separated)
     * whose outline path is [names], e.g. `["IntStack", "push"]`.
     */
    fun candidates(root: Root, relPath: String, names: List<String>): List<String> {
        if (names.isEmpty()) return emptyList()
        val out = ArrayList<String>()
        out += "sym:$relPath:${names.joinToString(".")}"
        val ext = relPath.substringAfterLast('.', "").lowercase()
        val noExt = relPath.removeSuffix(".d.ts").substringBeforeLast('.')
        val pkg = manifestName(root)
        fun nameFrom(manifest: String) = if (root.manifest == manifest) pkg else null
        when (ext) {
            "py", "pyi" -> {
                val parts = noExt.split('/').toMutableList()
                if (parts.firstOrNull() == "src" && !root.dir.hasFile("__init__.py")) parts.removeAt(0)
                if (root.dir.hasFile("__init__.py")) parts.add(0, root.dir.name)
                if (parts.lastOrNull() == "__init__") parts.removeAt(parts.lastIndex)
                out += "py:${(parts + names).joinToString(".")}"
            }
            "js", "mjs", "cjs", "jsx", "ts", "mts", "cts", "tsx" -> {
                val name = nameFrom("package.json") ?: root.dir.name
                val member = names.joinToString(".")
                out += "js:$name#$member"
                val sub = noExt.removeSuffix("/index").takeIf { it != "index" }
                if (sub != null) out += "js:$name/$sub#$member"
            }
            "go" -> {
                val module = nameFrom("go.mod") ?: root.dir.name
                val dir = relPath.substringBeforeLast('/', "")
                out += "go:${if (dir.isEmpty()) module else "$module/$dir"}.${names.joinToString(".")}"
            }
            "rs" -> {
                val crate = (nameFrom("Cargo.toml") ?: root.dir.name).replace(Regex("[^A-Za-z0-9_]"), "_")
                val mods = noExt.removePrefix("src/").split('/').toMutableList()
                if (mods.lastOrNull() in setOf("lib", "main", "mod")) mods.removeAt(mods.lastIndex)
                out += "rust:${(listOf(crate) + mods + names).joinToString("::")}"
            }
            "h", "hh", "hpp", "hxx", "c", "cc", "cpp", "cxx", "ixx" -> out += "cpp:${names.joinToString("::")}"
        }
        return out
    }
}
