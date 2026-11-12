package dev.ponder.sources

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive
import dev.ponder.format.LibraryDecl
import dev.ponder.format.PonderDocument
import dev.ponder.format.PonderValidator
import java.net.URI

/**
 * The Ponder online index protocol, version 1. Kotlin port of engine/src/sources/index-protocol.ts; both run
 * schema/conformance/index.json. Specification: docs/online-index.md.
 *
 *   GET <base>/v1/<ecosystem>/<package path>.json  ->  { ponderIndex: 1, ecosystem, name, documents: [...] }
 *
 * Everything here is pure and never throws for bad input.
 */
object IndexProtocol {
    const val INDEX_FORMAT = 1
    const val MAX_INDEX_BYTES = 2 * 1024 * 1024
    const val MAX_INDEX_DOCUMENTS = 32

    val ECOSYSTEMS = listOf("maven", "npm", "pypi", "crates", "go", "packagist", "nuget")

    private val SEGMENT = Regex("^[A-Za-z0-9][A-Za-z0-9._~-]*$")

    /** Canonical package name used in URLs and comparisons; null if [raw] cannot be a package of [ecosystem]. */
    fun canonicalName(ecosystem: String, raw: String): String? {
        val name = raw.trim()
        if (name.isEmpty() || name.length > 214) return null
        val canonical: String
        var segments: List<String>
        when (ecosystem) {
            "maven" -> {
                segments = name.split(':')
                if (segments.size != 2) return null
                canonical = name
            }
            "npm" -> {
                canonical = name.lowercase()
                segments = canonical.split('/')
                if (segments.size == 2) {
                    if (!segments[0].startsWith("@")) return null
                    segments = listOf(segments[0].substring(1), segments[1])
                } else if (segments.size != 1) return null
            }
            "pypi" -> { canonical = name.lowercase().replace(Regex("[-_.]+"), "-"); segments = listOf(canonical) }
            "crates" -> { canonical = name.lowercase().replace('_', '-'); segments = listOf(canonical) }
            "nuget" -> { canonical = name.lowercase(); segments = listOf(canonical) }
            "packagist" -> {
                canonical = name.lowercase()
                segments = canonical.split('/')
                if (segments.size != 2) return null
            }
            "go" -> {
                canonical = name
                segments = canonical.split('/')
                if (segments.size > 16) return null
            }
            else -> return null
        }
        for (s in segments) {
            if (!SEGMENT.matches(s) || s == "." || s == ".." || s.length > 128) return null
        }
        return canonical
    }

    /** Path relative to the index base, e.g. `v1/pypi/numpy.json`; null for names that are not safe to request. */
    fun indexPath(ecosystem: String, name: String): String? {
        if (ecosystem !in ECOSYSTEMS) return null
        val c = canonicalName(ecosystem, name) ?: return null
        val path = if (ecosystem == "maven") c.replaceFirst(':', '/') else c
        return "v$INDEX_FORMAT/$ecosystem/$path.json"
    }

    /** https, or http to this machine only. Returns the base ending in `/`, or null. */
    fun normalizeBaseUrl(raw: String): String? {
        val uri = try { URI(raw.trim()) } catch (e: Exception) { return null }
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val local = host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        if (scheme != "https" && !(scheme == "http" && local)) return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null) return null
        val port = if (uri.port == -1 || (scheme == "https" && uri.port == 443) || (scheme == "http" && uri.port == 80)) "" else ":${uri.port}"
        val path = (uri.rawPath ?: "").ifEmpty { "/" }
        return "$scheme://$host$port${if (path.endsWith("/")) path else "$path/"}"
    }

    // ------------------------------------------------------------------ versions

    private data class Version(val nums: List<Long>, val pre: String?)

    private val VERSION_RE =
        Regex("""^v?(\d+(?:\.\d+)*)(?:[-.]?([A-Za-z][0-9A-Za-z.-]*|[0-9A-Za-z.-]*[A-Za-z][0-9A-Za-z.-]*))?(?:\+.*)?$""")

    private fun parseVersion(raw: String): Version? {
        val m = VERSION_RE.matchEntire(raw.trim()) ?: return null
        val nums = m.groupValues[1].split('.').map { it.toLongOrNull() ?: return null }
        if (nums.any { it > 9_007_199_254_740_991L }) return null // same limit as JavaScript's safe integers
        return Version(nums, m.groupValues[2].ifEmpty { null }?.lowercase())
    }

    private fun compare(a: Version, b: Version): Int {
        for (i in 0 until maxOf(a.nums.size, b.nums.size)) {
            val d = (a.nums.getOrElse(i) { 0 }).compareTo(b.nums.getOrElse(i) { 0 })
            if (d != 0) return if (d < 0) -1 else 1
        }
        if (a.pre == b.pre) return 0
        if (a.pre == null) return 1
        if (b.pre == null) return -1
        return if (a.pre < b.pre) -1 else 1
    }

    /** See index-protocol.ts `versionInRange`: unknown versions only match "any version"; malformed ranges match nothing. */
    fun versionInRange(version: String?, range: String?): Boolean {
        if (range == null || range.isBlank() || range.trim() == "*") return true
        if (version == null) return false
        val v = parseVersion(version) ?: return false
        val parts = range.split(Regex("[\\s,]+")).filter { it.isNotEmpty() }
        if (parts.isEmpty() || parts.size > 8) return false
        for (p in parts) {
            val m = Regex("^(>=|<=|>|<|=)?(.+)$").matchEntire(p) ?: return false
            val bound = parseVersion(m.groupValues[2]) ?: return false
            val c = compare(v, bound)
            val ok = when (m.groupValues[1]) {
                ">=" -> c >= 0
                "<=" -> c <= 0
                ">" -> c > 0
                "<" -> c < 0
                else -> c == 0
            }
            if (!ok) return false
        }
        return true
    }

    // ------------------------------------------------------------------ index files

    /** One valid document from an index file. [text] is what the renderer receives. */
    class IndexDocument(val text: String, val versions: String?, val library: LibraryDecl, val document: PonderDocument)

    class ParsedIndex(val ok: Boolean, val documents: List<IndexDocument>, val problems: List<String>)

    fun libraryMatches(library: LibraryDecl, ecosystem: String, name: String): Boolean {
        val want = canonicalName(ecosystem, name) ?: return false
        if (ecosystem == "maven") {
            val group = library.group ?: return false
            return canonicalName("maven", "$group:${library.name}") == want
        }
        return canonicalName(ecosystem, library.name) == want
    }

    fun parseIndexFile(raw: String, ecosystem: String, name: String): ParsedIndex {
        fun fail(why: String) = ParsedIndex(false, emptyList(), listOf(why))
        if (raw.length > MAX_INDEX_BYTES) return fail("index file is larger than $MAX_INDEX_BYTES bytes")
        val text = raw.removePrefix("﻿") // Windows editors save UTF-8 with a byte order mark
        if (nestingTooDeep(text)) return fail("index file is not valid JSON") // hostile nesting; never recurse into it
        val json: JsonElement = try { JsonParser.parseString(text) } catch (e: Throwable) { return fail("index file is not valid JSON") }
        if (json !is JsonObject) return fail("index file is not a JSON object")
        val format = (json.get("ponderIndex") as? JsonPrimitive)?.takeIf { it.isNumber }?.asDouble
        if (format != INDEX_FORMAT.toDouble()) return fail("unsupported index format ${json.get("ponderIndex")}")
        val eco = (json.get("ecosystem") as? JsonPrimitive)?.takeIf { it.isString }?.asString
        if (eco != ecosystem) return fail("index file is for ecosystem ${json.get("ecosystem")}, not $ecosystem")
        val want = canonicalName(ecosystem, name)
        val got = (json.get("name") as? JsonPrimitive)?.takeIf { it.isString }?.asString
        if (got == null || want == null || canonicalName(ecosystem, got) != want) {
            return fail("index file is for package ${json.get("name")}, not $name")
        }
        val docs = json.get("documents") as? JsonArray ?: return fail("index file has no \"documents\" list")
        if (docs.size() > MAX_INDEX_DOCUMENTS) return fail("index file has more than $MAX_INDEX_DOCUMENTS documents")

        val out = ArrayList<IndexDocument>()
        val problems = ArrayList<String>()
        val gson = Gson()
        docs.forEachIndexed { i, entry ->
            val ponder = (entry as? JsonObject)?.get("ponder") as? JsonObject
            if (ponder == null) { problems += "documents[$i]: expected { \"versions\"?, \"ponder\": {...} }"; return@forEachIndexed }
            val versionsEl = entry.get("versions")
            val versions = when {
                versionsEl == null -> null
                versionsEl is JsonPrimitive && versionsEl.isString && versionsEl.asString.length <= 200 -> versionsEl.asString
                else -> { problems += "documents[$i].versions: expected a version range string"; return@forEachIndexed }
            }
            val docText = gson.toJson(ponder)
            val report = PonderValidator.validate(docText)
            val doc = report.document
            if (!report.ok || doc == null) {
                problems += "documents[$i].ponder: ${report.errors.firstOrNull() ?: "invalid"}"
                return@forEachIndexed
            }
            if (!libraryMatches(doc.library, ecosystem, name)) {
                problems += "documents[$i]: ponder.json library ${listOfNotNull(doc.library.group, doc.library.name).joinToString(":")} is not $name"
                return@forEachIndexed
            }
            out += IndexDocument(docText, versions, doc.library, doc)
        }
        return ParsedIndex(true, out, problems)
    }

    /** Bracket depth without recursion, so a hostile file cannot overflow the parser's stack. */
    private fun nestingTooDeep(text: String, max: Int = 64): Boolean {
        var depth = 0; var inString = false; var escaped = false
        for (c in text) {
            if (inString) {
                if (escaped) escaped = false else if (c == '\\') escaped = true else if (c == '"') inString = false
            } else when (c) {
                '"' -> inString = true
                '{', '[' -> if (++depth > max) return true
                '}', ']' -> depth--
            }
        }
        return false
    }
}
