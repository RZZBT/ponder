package dev.ponder.sources

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.util.io.HttpRequests
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.diagnostics.Severity
import java.io.IOException
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

/**
 * Client of the Ponder online index (protocol: docs/online-index.md). Only the package name is sent (as the URL);
 * never code. Results are cached on disk, so after one lookup a package works offline.
 *
 *  - found, or "this package has no animations" (404): cached for [FRESH_MS];
 *  - network or server problems: remembered for [RETRY_MS] so a flaky connection is not hammered, and any older
 *    cached copy keeps working meanwhile.
 *
 * Nothing in here throws to callers: every failure becomes a [Lookup] value.
 */
@Service(Service.Level.APP)
class OnlineIndex {

    /** What is known about one package in the index. */
    sealed interface Lookup {
        val fetchedAt: Long
        class Index(val parsed: IndexProtocol.ParsedIndex, override val fetchedAt: Long) : Lookup
        class Absent(override val fetchedAt: Long) : Lookup
        class Failed(val reason: String, override val fetchedAt: Long, val previous: Index?) : Lookup
    }

    /** HTTP transport; replaced in tests. */
    fun interface Fetcher {
        /** Body of a 2xx response, or null for 404/410. Throws [IOException] for anything else. */
        fun get(url: String, maxBytes: Int): String?
    }

    private class Entry(val lookup: Lookup, val body: String?)

    private val memory = ConcurrentHashMap<String, Entry>()
    private val locks = ConcurrentHashMap<String, Any>()

    internal var fetcher: Fetcher = IdeFetcher
    internal var clock: () -> Long = System::currentTimeMillis
    internal var cacheDir: Path = Path.of(PathManager.getSystemPath(), "ponder", "index-cache")

    /** Cached knowledge, fresh or stale. Never touches the network. */
    fun cached(base: String, key: PackageKey): Lookup? {
        val url = urlFor(base, key) ?: return null
        memory[url]?.let { return it.lookup }
        val fromDisk = readDisk(url) ?: return null
        memory[url] = fromDisk
        return fromDisk.lookup
    }

    /** True when [cached] has nothing usable that is still within its lifetime. */
    fun needsFetch(base: String, key: PackageKey): Boolean {
        val c = cached(base, key) ?: return urlFor(base, key) != null
        if (isLocalBase(base)) return true // a test index on this machine: always pick up the latest edit
        val age = clock() - c.fetchedAt
        return when (c) {
            is Lookup.Index, is Lookup.Absent -> age > FRESH_MS || age < 0
            is Lookup.Failed -> age > RETRY_MS || age < 0
        }
    }

    /**
     * Fetches the package's index file (blocking; never on the UI thread, never inside a read action).
     * Concurrent calls for the same package share one request.
     */
    fun fetch(base: String, key: PackageKey): Lookup {
        val app = ApplicationManager.getApplication()
        check(app == null || (!app.isDispatchThread && !app.isReadAccessAllowed)) { "network access on the UI thread or in a read action" }
        val url = urlFor(base, key) ?: return Lookup.Failed("not a valid package name or index address", clock(), null)
        synchronized(locks.computeIfAbsent(url) { Any() }) {
            if (!needsFetch(base, key)) return cached(base, key)!!
            val previous = (cached(base, key) as? Lookup.Index)
                ?: ((cached(base, key) as? Lookup.Failed)?.previous)
            val now = clock()
            val entry = try {
                val body = fetcher.get(url, IndexProtocol.MAX_INDEX_BYTES)
                if (body == null) {
                    Entry(Lookup.Absent(now), null)
                } else {
                    val parsed = IndexProtocol.parseIndexFile(body, key.ecosystem, key.name)
                    if (parsed.problems.isNotEmpty()) {
                        service<PonderDiagnostics>().recordIssues(url, if (parsed.ok) Severity.WARNING else Severity.ERROR,
                            parsed.problems.map { dev.ponder.format.Issue("$", it) })
                    }
                    if (parsed.ok) Entry(Lookup.Index(parsed, now), body)
                    else Entry(Lookup.Failed("the index file for ${key.name} is broken", now, previous), null)
                }
            } catch (e: IOException) {
                Entry(Lookup.Failed(friendly(e), now, previous), null)
            } catch (e: Exception) {
                Entry(Lookup.Failed("unexpected problem: ${e.javaClass.simpleName}", now, previous), null)
            }
            memory[url] = entry
            writeDisk(url, entry)
            return entry.lookup
        }
    }

    /**
     * Brings a stale cached copy up to date for next time, off the UI thread. Used after an animation was shown
     * from the cache, so a fixed or updated index file reaches people who already looked once. Never throws.
     */
    fun refreshInBackground(base: String, key: PackageKey) {
        try {
            if (!needsFetch(base, key)) return
            ApplicationManager.getApplication().executeOnPooledThread {
                try { fetch(base, key) } catch (e: Throwable) { /* the cached copy stays in use */ }
            }
        } catch (e: Throwable) { /* the cached copy stays in use */ }
    }

    fun clearCache() {
        memory.clear()
        try {
            if (Files.isDirectory(cacheDir)) Files.list(cacheDir).use { s -> s.forEach { runCatching { Files.deleteIfExists(it) } } }
        } catch (e: Exception) { /* nothing to clear */ }
    }

    // ------------------------------------------------------------------ disk cache

    private fun fileFor(url: String): Path {
        val hash = MessageDigest.getInstance("SHA-256").digest(url.toByteArray()).joinToString("") { "%02x".format(it) }
        return cacheDir.resolve("$hash.json")
    }

    private fun writeDisk(url: String, entry: Entry) {
        try {
            Files.createDirectories(cacheDir)
            val o = JsonObject().apply {
                addProperty("v", 1)
                addProperty("url", url)
                addProperty("at", entry.lookup.fetchedAt)
                addProperty("status", when (entry.lookup) { is Lookup.Index -> "ok"; is Lookup.Absent -> "absent"; is Lookup.Failed -> "failed" })
                entry.body?.let { addProperty("body", it) }
                (entry.lookup as? Lookup.Failed)?.let { addProperty("reason", it.reason) }
            }
            // a failure must not overwrite a good copy on disk: the good copy is what works offline
            if (entry.lookup is Lookup.Failed && Files.exists(fileFor(url))) return
            val target = fileFor(url)
            val tmp = Files.createTempFile(cacheDir, "w", ".tmp")
            Files.writeString(tmp, o.toString())
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } catch (e: Exception) {
            // a read-only or full disk only means no offline copy
        }
    }

    private fun readDisk(url: String): Entry? {
        val file = fileFor(url)
        return try {
            if (!Files.isRegularFile(file) || Files.size(file) > IndexProtocol.MAX_INDEX_BYTES * 2L) return null
            val o = JsonParser.parseString(Files.readString(file)).asJsonObject
            if (o["v"]?.asInt != 1 || o["url"]?.asString != url) return null
            val at = o["at"].asLong
            when (o["status"]?.asString) {
                "ok" -> {
                    val body = o["body"].asString
                    val key = keyFromUrl(url) ?: return null
                    val parsed = IndexProtocol.parseIndexFile(body, key.first, key.second)
                    if (parsed.ok) Entry(Lookup.Index(parsed, at), body) else null
                }
                "absent" -> Entry(Lookup.Absent(at), null)
                "failed" -> Entry(Lookup.Failed(o["reason"]?.asString ?: "unavailable", at, null), null)
                else -> null
            }
        } catch (e: Exception) {
            runCatching { Files.deleteIfExists(file) } // corrupt cache entry: drop it and fetch again later
            null
        }
    }

    private fun keyFromUrl(url: String): Pair<String, String>? {
        val path = url.substringAfter("/v${IndexProtocol.INDEX_FORMAT}/", "").removeSuffix(".json")
        val ecosystem = path.substringBefore('/')
        val rest = path.substringAfter('/', "")
        if (ecosystem !in IndexProtocol.ECOSYSTEMS || rest.isEmpty()) return null
        return ecosystem to if (ecosystem == "maven") rest.replaceFirst('/', ':') else rest
    }

    companion object {
        const val FRESH_MS = 24L * 60 * 60 * 1000
        const val RETRY_MS = 15L * 60 * 1000

        private val LOCAL_BASE = Regex("^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\])[:/]")

        /** An index served from this machine, for testing before publishing. */
        fun isLocalBase(base: String): Boolean = IndexProtocol.normalizeBaseUrl(base)?.let { LOCAL_BASE.containsMatchIn(it) } == true

        fun urlFor(base: String, key: PackageKey): String? {
            val b = IndexProtocol.normalizeBaseUrl(base) ?: return null
            val path = IndexProtocol.indexPath(key.ecosystem, key.name) ?: return null
            return b + path
        }

        /** Short, non-technical reason for a failed lookup. */
        internal fun friendly(e: IOException): String = when {
            e is HttpRequests.HttpStatusException -> "the index answered with error ${e.statusCode}"
            e is java.net.UnknownHostException -> "you seem to be offline"
            e is java.net.SocketTimeoutException -> "the index did not answer in time"
            e is java.net.ConnectException -> "the index could not be reached"
            e.message?.contains("too large") == true -> "the index file is too large"
            else -> "the index could not be reached"
        }
    }
}

/** HTTP through the IDE: honours its proxy settings and certificates, with short timeouts and a size cap. */
private object IdeFetcher : OnlineIndex.Fetcher {
    override fun get(url: String, maxBytes: Int): String? = try {
        HttpRequests.request(url)
            .connectTimeout(4_000)
            .readTimeout(6_000)
            .productNameAsUserAgent()
            .throwStatusCodeException(true)
            .connect { request ->
                val bytes = request.inputStream.readNBytes(maxBytes + 1)
                if (bytes.size > maxBytes) throw IOException("index file too large")
                String(bytes, Charsets.UTF_8)
            }
    } catch (e: HttpRequests.HttpStatusException) {
        if (e.statusCode == 404 || e.statusCode == 410) null else throw e
    }
}

/** The first animation in a cached index that fits the installed version and one of [candidates]. */
fun OnlineIndex.Lookup.findAnimation(key: PackageKey, candidates: List<String>): ExternalHit? {
    val index = when (this) {
        is OnlineIndex.Lookup.Index -> this
        is OnlineIndex.Lookup.Failed -> previous ?: return null // offline: keep using the last good copy
        is OnlineIndex.Lookup.Absent -> return null
    }
    for (d in index.parsed.documents) {
        if (!IndexProtocol.versionInRange(key.version, d.versions)) continue
        val animation = d.document.findAny(candidates) ?: continue
        return ExternalHit(animation, d.document, "Community index · ${key.ecosystem}/${key.name}")
    }
    return null
}
