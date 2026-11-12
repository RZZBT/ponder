package dev.ponder.sources

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.diagnostics.Severity
import dev.ponder.format.AnimationInfo
import dev.ponder.format.PonderDocument
import dev.ponder.format.PonderLimits
import dev.ponder.format.PonderValidator
import dev.ponder.settings.PonderSettings
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.BasicFileAttributes
import java.util.concurrent.ConcurrentHashMap
import kotlin.io.path.extension
import kotlin.io.path.isDirectory

/** An animation found outside the library: in a local folder or the online index. */
class ExternalHit(val animation: AnimationInfo, val document: PonderDocument, val source: String)

/**
 * ponder.json files kept outside libraries: `<project>/.ponder/` and the folders listed in Settings | Tools | Ponder.
 * Any `*.json` file there that is a valid ponder document counts. A file only applies to the package its `library`
 * names, so a file for numpy can never explain a function of another package.
 */
@Service(Service.Level.APP)
class LocalFolders {
    private class Entry(val modified: Long, val size: Long, val document: PonderDocument?)

    private val cache = ConcurrentHashMap<Path, Entry>()

    fun folders(project: Project?): List<Path> {
        val out = LinkedHashSet<Path>()
        project?.guessProjectDir()?.toNioPathOrNull()?.resolve(PROJECT_FOLDER)?.let { out.add(it) }
        service<PonderSettings>().state.localFolders.orEmpty().lineSequence()
            .map { it.trim() }.filter { it.isNotEmpty() }
            .mapNotNull { try { Path.of(it) } catch (e: Exception) { null } }
            .forEach { out.add(it) }
        return out.filter { it.isDirectory() }
    }

    fun find(project: Project?, key: PackageKey, candidates: List<String>): ExternalHit? {
        for (folder in folders(project)) {
            for (file in jsonFiles(folder)) {
                val doc = load(file) ?: continue
                if (!IndexProtocol.libraryMatches(doc.library, key.ecosystem, key.name)) continue
                val animation = doc.findAny(candidates) ?: continue
                return ExternalHit(animation, doc, "Local file · ${file.fileName}")
            }
        }
        return null
    }

    private fun jsonFiles(folder: Path): List<Path> = try {
        Files.walk(folder, MAX_DEPTH).use { s ->
            s.filter { it.extension.equals("json", ignoreCase = true) && Files.isRegularFile(it) }.limit(MAX_FILES).toList().sorted()
        }
    } catch (e: Exception) {
        emptyList()
    }

    private fun load(file: Path): PonderDocument? {
        val attrs = try { Files.readAttributes(file, BasicFileAttributes::class.java) } catch (e: Exception) { return null }
        val modified = attrs.lastModifiedTime().toMillis()
        cache[file]?.takeIf { it.modified == modified && it.size == attrs.size() }?.let { return it.document }
        val doc = if (attrs.size() > PonderLimits.MAX_FILE_BYTES) {
            report(file, "File is too large (${attrs.size()} bytes, maximum ${PonderLimits.MAX_FILE_BYTES}).")
            null
        } else {
            val text = try { Files.readString(file) } catch (e: Exception) { null }
            // only report files that look like ponder documents; other JSON (package.json, ...) is simply ignored
            if (text == null || !text.contains("\"animations\"")) null
            else PonderValidator.validate(text).also { r -> if (!r.ok) r.errors.take(5).forEach { report(file, it.toString()) } }.document
        }
        cache[file] = Entry(modified, attrs.size(), doc)
        return doc
    }

    private fun report(file: Path, message: String) =
        service<PonderDiagnostics>().record(Severity.ERROR, file.toString().replace('\\', '/'), message)

    fun clearCache() = cache.clear()

    companion object {
        const val PROJECT_FOLDER = ".ponder"
        private const val MAX_DEPTH = 3
        private const val MAX_FILES = 500L
    }
}

private fun com.intellij.openapi.vfs.VirtualFile.toNioPathOrNull(): Path? = try { toNioPath() } catch (e: Exception) { null }
