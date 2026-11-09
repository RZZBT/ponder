package dev.ponder.resolution

import com.intellij.openapi.module.Module
import com.intellij.openapi.vfs.VirtualFile

/** Where a declaration lives. Kept separate from [SymbolIdentity]: the same signature in two jars is two symbols. */
sealed interface Provenance {
    val key: String

    /** A JVM library; [root] is the classes root (jar root or class directory) containing the declaring class. */
    data class Library(
        val rootUrl: String,
        val root: VirtualFile,
        /** IDE library entry name, e.g. "Gradle: com.example:math-utils:1.0.0". */
        val libraryName: String?,
    ) : Provenance {
        override val key: String get() = "lib:$rootUrl"
    }

    data class ProjectModule(val module: Module) : Provenance {
        override val key: String get() = "module:${module.name}"
    }

    /**
     * A source package (npm, PyPI, crate, Go module, ...). [root] is the package folder, [ponderPath] the
     * ponder.json inside it if there is one, [manifestName] the name from package.json, Cargo.toml, ...
     */
    data class Package(val root: VirtualFile, val ponderPath: String?, val manifestName: String?) : Provenance {
        override val key: String get() = "pkg:${root.url}"
    }
}

/** A resolved declaration and the symbol strings that identify it. */
data class SymbolIdentity(
    val language: String,
    val provenance: Provenance,
    /** The main symbol string, e.g. `com.example.MathUtils#clamp(int,int,int)` or `py:mathutils.clamp`. */
    val signature: String,
    /** Other strings that identify the same declaration (other schemes, `sym:`). */
    val alternatives: List<String> = emptyList(),
    /** Short name for messages. */
    val displayName: String,
    /** JVM only: the declaring class, not the use-site type. */
    val declaringClass: String? = null,
) {
    val candidates: List<String> get() = listOf(signature) + alternatives
}
