package dev.ponder.diagnostics

import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.thisLogger
import dev.ponder.format.Issue
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedDeque

enum class Severity { INFO, WARNING, ERROR }

data class PonderDiagnostic(
    val time: Instant,
    val severity: Severity,
    val source: String,
    val message: String,
) {
    override fun toString() = "[$severity] $source: $message"
}

/** Problems found in library ponder.json files, shown by Tools | Ponder: Show Diagnostics and logged. */
@Service(Service.Level.APP)
class PonderDiagnostics {
    private val entries = ConcurrentLinkedDeque<PonderDiagnostic>()

    /** The daemon re-checks the same files often; record each report once. */
    private val seen = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

    fun record(severity: Severity, source: String, message: String) {
        if (seen.size > MAX_ENTRIES * 4) seen.clear()
        if (!seen.add("$severity|$source|$message")) return
        entries.addLast(PonderDiagnostic(Instant.now(), severity, source, message))
        while (entries.size > MAX_ENTRIES) entries.pollFirst()
        when (severity) {
            Severity.ERROR, Severity.WARNING -> LOG.warn("Ponder: $source: $message")
            Severity.INFO -> LOG.debug("Ponder: $source: $message")
        }
    }

    fun recordIssues(source: String, severity: Severity, issues: List<Issue>) {
        issues.take(MAX_ISSUES_PER_SOURCE).forEach { record(severity, source, it.toString()) }
        if (issues.size > MAX_ISSUES_PER_SOURCE) record(severity, source, "...and ${issues.size - MAX_ISSUES_PER_SOURCE} more.")
    }

    fun snapshot(): List<PonderDiagnostic> = entries.toList()

    fun clear() { entries.clear(); seen.clear() }

    private companion object {
        const val MAX_ENTRIES = 200
        const val MAX_ISSUES_PER_SOURCE = 10
        val LOG = thisLogger()
    }
}
