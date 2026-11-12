package dev.ponder.sources

import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.vfs.VirtualFile
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.matching.PonderRegistry
import dev.ponder.packages.PackageLayout
import dev.ponder.resolution.Provenance
import dev.ponder.resolution.SymbolIdentity

/**
 * The package a declaration belongs to, as the online index and local folders know it. Only built from evidence
 * the IDE can see (pom.properties, the IDE library name, a package manifest, an installed `.dist-info`); never
 * guessed from a file name. [version] is null when the installed version is unknown.
 */
data class PackageKey(
    val ecosystem: String,
    val name: String,
    val version: String?,
    val evidence: LibraryEvidence.Source,
) {
    val display: String get() = "$ecosystem/$name" + (version?.let { " $it" } ?: "")
}

object PackageKeys {
    private const val MAX_MANIFEST_BYTES = 256 * 1024L
    private const val MAX_SCANNED_ENTRIES = 3000

    /**
     * Null when the declaration is the user's own code (never sent anywhere, never matched against local files),
     * or when its package cannot be identified for sure.
     */
    fun of(identity: SymbolIdentity, registry: PonderRegistry, project: Project): PackageKey? = try {
        when (val p = identity.provenance) {
            is Provenance.ProjectModule -> null // your own code: nothing to look up
            is Provenance.Package -> if (isOwnCode(project, p.root)) null else ofPackageRoot(p.root, p.manifestName)
            is Provenance.Library -> {
                val ev = registry.evidenceFor(p)
                // a fat jar with several pom.properties: which one declares the class is unknowable, so skip
                val c = ev.coordinates.singleOrNull()
                if (c == null || !ev.known) null
                else PackageKey("maven", "${c.group}:${c.name}", c.version, ev.source).takeIf { valid(it) }
            }
        }
    } catch (e: Exception) {
        null // identification problems must never surface as errors; they only mean "no online lookup"
    }

    private val DEPENDENCY_FOLDER = Regex("""/(node_modules|site-packages|dist-packages|vendor)/""")

    /**
     * A package inside the project's own sources (your package.json, your pyproject.toml) is your code, not a
     * dependency. Library roots and dependency folders (node_modules, site-packages, ...) are dependencies even when
     * they sit inside the project directory.
     */
    internal fun isOwnCode(project: Project, root: VirtualFile): Boolean {
        if (DEPENDENCY_FOLDER.containsMatchIn(root.path + "/")) return false
        val index = ProjectFileIndex.getInstance(project)
        if (index.isInLibrary(root)) return false
        return index.isInContent(root)
    }

    private fun valid(k: PackageKey) = IndexProtocol.indexPath(k.ecosystem, k.name) != null

    internal fun ofPackageRoot(root: VirtualFile, manifestName: String?): PackageKey? {
        val manifest = PackageLayout.MANIFESTS.firstOrNull { root.findChild(it)?.isDirectory == false }
        if (manifest != null) {
            val ecosystem = ecosystemForManifest(manifest)
            val name = manifestName
            if (ecosystem != null && name != null) {
                val text = readSmall(root.findChild(manifest))
                val version = when {
                    ecosystem == "go" -> goVersionFromDirName(root.name)
                    text != null -> manifestVersion(manifest, text)
                    else -> null
                }
                return PackageKey(ecosystem, name, version, LibraryEvidence.Source.PACKAGE_MANIFEST).takeIf { valid(it) }
            }
        }
        // an installed Python package (site-packages/numpy/) has no manifest of its own; pip's .dist-info names it
        if (root.findChild("__init__.py") != null) {
            val dist = findPythonDist(root) ?: return null
            return PackageKey("pypi", dist.first, dist.second, LibraryEvidence.Source.PACKAGE_MANIFEST).takeIf { valid(it) }
        }
        return null
    }

    private fun findPythonDist(packageDir: VirtualFile): Pair<String, String?>? {
        val parent = packageDir.parent ?: return null
        val children = parent.children ?: return null
        if (children.size > MAX_SCANNED_ENTRIES) return null
        val module = packageDir.name
        for (d in children) {
            if (!d.isDirectory || !d.name.endsWith(".dist-info")) continue
            val topLevel = readSmall(d.findChild("top_level.txt"))
            val provides = topLevel?.lineSequence()?.map { it.trim() }?.any { it == module }
                ?: PackageLayout.sameName(distNameFromDir(d.name), module)
            if (!provides) continue
            val meta = readSmall(d.findChild("METADATA")) ?: continue
            return parseDistMetadata(meta)
        }
        return null
    }

    private fun readSmall(f: VirtualFile?): String? {
        if (f == null || f.isDirectory || f.length > MAX_MANIFEST_BYTES) return null
        return try { String(f.contentsToByteArray(), Charsets.UTF_8) } catch (e: Exception) { null }
    }

    // ------------------------------------------------------------------ pure helpers (unit-tested)

    fun ecosystemForManifest(manifest: String): String? = when (manifest) {
        "package.json" -> "npm"
        "Cargo.toml" -> "crates"
        "go.mod" -> "go"
        "pyproject.toml", "setup.cfg", "setup.py" -> "pypi"
        "composer.json" -> "packagist"
        else -> null
    }

    fun manifestVersion(manifest: String, text: String): String? = when (manifest) {
        "package.json", "composer.json" -> Regex(""""version"\s*:\s*"([^"]{1,64})"""").find(text)?.groupValues?.get(1)
        "Cargo.toml", "pyproject.toml" -> tomlValue(text, "version", setOf("[package]", "[project]", "[tool.poetry]"))
        "setup.cfg" -> Regex("""(?m)^version\s*=\s*(\S{1,64})""").find(text)?.groupValues?.get(1)
        else -> null
    }?.takeIf { it.isNotBlank() }

    /** Go's module cache stores `github.com/gorilla/mux@v1.8.0`; a checked-out module has no version. */
    fun goVersionFromDirName(dirName: String): String? =
        dirName.substringAfterLast('@', "").takeIf { it.startsWith("v") && it.length > 1 }

    /** `numpy-1.26.4.dist-info` -> `numpy`. */
    fun distNameFromDir(dirName: String): String = dirName.removeSuffix(".dist-info").substringBefore('-')

    /** Name and version from a `.dist-info/METADATA` file (RFC 822 style headers). */
    fun parseDistMetadata(text: String): Pair<String, String?>? {
        var name: String? = null
        var version: String? = null
        for (line in text.lineSequence()) {
            if (line.isEmpty()) break // headers end at the first blank line
            if (name == null && line.startsWith("Name:")) name = line.removePrefix("Name:").trim()
            if (version == null && line.startsWith("Version:")) version = line.removePrefix("Version:").trim()
        }
        return name?.takeIf { it.isNotEmpty() }?.let { it to version?.ifEmpty { null } }
    }

    private fun tomlValue(text: String, key: String, sections: Set<String>): String? {
        var section = ""
        for (line in text.lineSequence()) {
            val t = line.trim()
            if (t.startsWith("[")) section = t
            else if (section in sections) {
                Regex("""^$key\s*=\s*["']([^"']{1,64})["']""").find(t)?.let { return it.groupValues[1] }
            }
        }
        return null
    }
}
