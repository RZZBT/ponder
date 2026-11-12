package dev.ponder.discovery

import com.intellij.openapi.vfs.VirtualFile
import dev.ponder.format.LibraryDecl
import java.util.Properties

data class MavenCoordinates(val group: String, val name: String, val version: String?) {
    override fun toString() = "$group:$name${version?.let { ":$it" } ?: ""}"
}

/** A library's coordinates and where they came from. */
class LibraryEvidence(val coordinates: List<MavenCoordinates>, val source: Source) {
    enum class Source {
        /** `META-INF/maven/<g>/<a>/pom.properties` inside the jar. */
        POM_PROPERTIES,
        /** The IDE library name, "Gradle: g:a:v" or "Maven: g:a:v". */
        LIBRARY_NAME,
        /** package.json, Cargo.toml, go.mod, pyproject.toml, ... at the package root. */
        PACKAGE_MANIFEST,
        /** The declaration is in the language's standard library (the JDK, typeshed, a Rust toolchain, GOROOT). */
        STANDARD_LIBRARY,
        NONE,
    }

    val known: Boolean get() = source != Source.NONE
}

sealed interface LibraryVerdict {
    data class Verified(val by: LibraryEvidence.Source) : LibraryVerdict
    /** No coordinates found; the file is still in the same root as the declaration. */
    data object Unverifiable : LibraryVerdict
    data class Mismatch(val reason: String) : LibraryVerdict
}

/** Reads a classes root's Maven coordinates (not from the jar file name) and checks ponder.json's `library` against them. */
object LibraryCoordinatesDetector {
    private const val MAX_POMS = 16

    fun detect(root: VirtualFile, libraryName: String?): LibraryEvidence {
        val poms = readPomProperties(root)
        if (poms.isNotEmpty()) return LibraryEvidence(poms, LibraryEvidence.Source.POM_PROPERTIES)
        parseLibraryName(libraryName)?.let { return LibraryEvidence(listOf(it), LibraryEvidence.Source.LIBRARY_NAME) }
        return LibraryEvidence(emptyList(), LibraryEvidence.Source.NONE)
    }

    private fun readPomProperties(root: VirtualFile): List<MavenCoordinates> {
        val maven = root.findChild("META-INF")?.findChild("maven") ?: return emptyList()
        val out = ArrayList<MavenCoordinates>()
        for (groupDir in maven.children) {
            if (!groupDir.isDirectory) continue
            for (artifactDir in groupDir.children) {
                val pom = artifactDir.takeIf { it.isDirectory }?.findChild("pom.properties") ?: continue
                if (pom.length > 16 * 1024) continue
                parsePomProperties(String(pom.contentsToByteArray(), Charsets.UTF_8))?.let { out += it }
                if (out.size >= MAX_POMS) return out
            }
        }
        return out
    }

    fun parsePomProperties(text: String): MavenCoordinates? {
        val p = Properties().apply { load(text.reader()) }
        val g = p.getProperty("groupId")?.trim().orEmpty()
        val a = p.getProperty("artifactId")?.trim().orEmpty()
        if (g.isEmpty() || a.isEmpty()) return null
        return MavenCoordinates(g, a, p.getProperty("version")?.trim()?.ifEmpty { null })
    }

    private val NAME_RE = Regex("""^(?:Gradle|Maven): ([^:\s]+):([^:\s]+):([^:\s]+)(?::\S+)?$""")

    /** Parses names such as `Gradle: com.example:math-utils:1.0.0` or `Maven: com.example:math-utils:1.0.0`. */
    fun parseLibraryName(name: String?): MavenCoordinates? {
        val m = NAME_RE.matchEntire(name ?: return null) ?: return null
        return MavenCoordinates(m.groupValues[1], m.groupValues[2], m.groupValues[3])
    }

    /** `library` group and name must equal one of the detected coordinates. Without coordinates the file is accepted. */
    fun verify(declared: LibraryDecl, evidence: LibraryEvidence): LibraryVerdict {
        if (!evidence.known) return LibraryVerdict.Unverifiable
        val ok = evidence.coordinates.any { (declared.group == null || it.group == declared.group) && it.name == declared.name }
        return if (ok) LibraryVerdict.Verified(evidence.source)
        else LibraryVerdict.Mismatch(
            "ponder.json declares library ${listOfNotNull(declared.group, declared.name).joinToString(":")}, but the library that contains this symbol is " +
                evidence.coordinates.joinToString(" / ") + " (according to ${evidence.source.name.lowercase().replace('_', ' ')})."
        )
    }
}
