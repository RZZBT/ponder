package dev.ponder.matching

import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootEvent
import com.intellij.openapi.roots.ModuleRootListener
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.diagnostics.Severity
import dev.ponder.discovery.LibraryCoordinatesDetector
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.discovery.PonderDiscovery
import dev.ponder.format.Issue
import dev.ponder.format.PonderDocument
import dev.ponder.format.PonderLimits
import dev.ponder.format.PonderValidator
import dev.ponder.format.ValidationReport
import dev.ponder.resolution.Provenance
import java.util.concurrent.ConcurrentHashMap

/** A validated ponder.json. Invalid files are cached too, so they are reported once. */
class LoadedDocument(val file: VirtualFile, val report: ValidationReport) {
    val document: PonderDocument? get() = report.document
    val description: String get() = file.path // always "/"-separated, e.g. C:/libs/x.jar!/META-INF/ponder/ponder.json
}

/**
 * Per-project cache of ponder.json documents and library coordinates. Entries carry the file and jar timestamps
 * and are re-read when those change; the listeners only free entries early.
 */
@Service(Service.Level.PROJECT)
class PonderRegistry(project: Project) : Disposable {

    private data class Stamp(val url: String, val time: Long, val length: Long, val containerTime: Long, val containerLength: Long)
    private class DocEntry(val stamp: Stamp, val loaded: LoadedDocument)
    private class EvidenceEntry(val stamp: Stamp, val libraryName: String?, val evidence: LibraryEvidence)

    private val documents = ConcurrentHashMap<String, DocEntry>()
    private val evidence = ConcurrentHashMap<String, EvidenceEntry>()

    val cacheSize: Int get() = documents.size

    init {
        val bus = project.messageBus.connect(this)
        bus.subscribe(ModuleRootListener.TOPIC, object : ModuleRootListener {
            override fun rootsChanged(event: ModuleRootEvent) = invalidateAll() // libraries added/removed/changed
        })
        bus.subscribe(VirtualFileManager.VFS_CHANGES, object : BulkFileListener {
            override fun after(events: List<VFileEvent>) {
                if (documents.isEmpty() && evidence.isEmpty()) return
                if (events.any { it.path.endsWith("/ponder.json") || it.path.endsWith(".jar") || it.path.endsWith("pom.properties") }) invalidateAll()
            }
        })
    }

    fun invalidateAll() {
        documents.clear()
        evidence.clear()
    }

    /** Null if the container has no ponder.json. Thread-safe. */
    fun documentFor(provenance: Provenance): LoadedDocument? {
        val file = PonderDiscovery.locate(provenance)
        if (file == null) {
            documents.remove(provenance.key)
            return null
        }
        val stamp = stampOf(file)
        documents[provenance.key]?.takeIf { it.stamp == stamp }?.let { return it.loaded }

        val loaded = load(file)
        documents[provenance.key] = DocEntry(stamp, loaded)
        val diag = service<PonderDiagnostics>()
        if (!loaded.report.ok) {
            diag.recordIssues(loaded.description, Severity.ERROR, loaded.report.errors)
        } else {
            diag.recordIssues(loaded.description, Severity.WARNING, loaded.report.warnings)
        }
        return loaded
    }

    /** Coordinates of a library root, cached per root and jar stamp. */
    fun evidenceFor(lib: Provenance.Library): LibraryEvidence {
        val container = VfsUtilCore.getVirtualFileForJar(lib.root) ?: lib.root
        val stamp = Stamp(container.url, container.timeStamp, container.length, 0, 0)
        evidence[lib.key]?.takeIf { it.stamp == stamp && it.libraryName == lib.libraryName }?.let { return it.evidence }
        val detected = LibraryCoordinatesDetector.detect(lib.root, lib.libraryName)
        evidence[lib.key] = EvidenceEntry(stamp, lib.libraryName, detected)
        return detected
    }

    private fun load(file: VirtualFile): LoadedDocument {
        // check the size before reading the content into memory
        if (file.length > PonderLimits.MAX_FILE_BYTES) {
            return invalid(file, "File is too large (${file.length} bytes, maximum ${PonderLimits.MAX_FILE_BYTES}).")
        }
        val text = try {
            String(file.contentsToByteArray(), Charsets.UTF_8)
        } catch (e: Exception) {
            return invalid(file, "Cannot read file: ${e.message}")
        }
        return LoadedDocument(file, PonderValidator.validate(text))
    }

    private fun invalid(file: VirtualFile, message: String) =
        LoadedDocument(file, ValidationReport(listOf(Issue("$", message)), emptyList(), null))

    private fun stampOf(file: VirtualFile): Stamp {
        val container = VfsUtilCore.getVirtualFileForJar(file)
        return Stamp(file.url, file.timeStamp, file.length, container?.timeStamp ?: 0, container?.length ?: 0)
    }

    override fun dispose() = invalidateAll()
}
