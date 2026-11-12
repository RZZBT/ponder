package dev.ponder

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey
import dev.ponder.sources.findAnimation
import dev.ponder.testing.TestLibs
import java.io.IOException
import java.net.UnknownHostException
import java.nio.file.Files
import java.util.concurrent.Callable
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** The online index client against a scripted fake transport: caching, lifetimes, offline behaviour, bad data. */
class OnlineIndexTest : BasePlatformTestCase() {
    private val base = "https://index.test/"
    private val key = PackageKey("pypi", "mathutils", "1.2.0", LibraryEvidence.Source.PACKAGE_MANIFEST)
    private val candidates = listOf("py:mathutils.abs")
    private lateinit var index: OnlineIndex
    private var now = 1_000_000_000L
    private val calls = AtomicInteger()
    private var respond: (String) -> String? = { indexBody() }

    override fun setUp() {
        super.setUp()
        index = OnlineIndex()
        index.cacheDir = TestLibs.tempDir("ponder-cache")
        index.clock = { now }
        index.fetcher = OnlineIndex.Fetcher { url, _ -> calls.incrementAndGet(); respond(url) }
        service<PonderDiagnostics>().clear()
    }

    private fun indexBody(title: String = "abs", versions: String? = ">=1.0") = """
        { "ponderIndex": 1, "ecosystem": "pypi", "name": "mathutils", "documents": [
          { ${versions?.let { "\"versions\": \"$it\"," } ?: ""} "ponder": { "version": 1, "library": { "name": "mathutils" },
            "animations": { "abs": { "symbol": "py:mathutils.abs", "title": "$title",
              "actors": { "d": { "type": "circle" } }, "slides": [ { "caption": "x" } ] } } } } ] }
    """.trimIndent()

    /** fetch() refuses the UI thread (tests run on it), so run it on a pooled thread. */
    private fun fetch(k: PackageKey = key): OnlineIndex.Lookup =
        ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch(base, k) }).get(20, TimeUnit.SECONDS)

    fun testRequestsTheDocumentedUrlAndFindsTheAnimation() {
        var asked = ""
        respond = { url -> asked = url; indexBody() }
        val l = fetch()
        assertEquals("https://index.test/v1/pypi/mathutils.json", asked)
        assertEquals("abs", l.findAnimation(key, candidates)?.animation?.title)
        assertNull(l.findAnimation(key, listOf("py:mathutils.other")))
    }

    fun testFreshResultsAreCachedAndNotRefetched() {
        fetch()
        assertFalse(index.needsFetch(base, key))
        fetch(); fetch()
        assertEquals(1, calls.get())
        now += OnlineIndex.FRESH_MS + 1
        assertTrue(index.needsFetch(base, key))
        fetch()
        assertEquals(2, calls.get())
    }

    fun testMissingPackageIsRememberedAsAbsent() {
        respond = { null } // 404
        val l = fetch()
        assertTrue(l is OnlineIndex.Lookup.Absent)
        assertNull(l.findAnimation(key, candidates))
        fetch()
        assertEquals("a 404 is cached like a hit", 1, calls.get())
    }

    fun testOfflineGivesAFriendlyReasonAndRetriesOnlyLater() {
        respond = { throw UnknownHostException("index.test") }
        val l = fetch() as OnlineIndex.Lookup.Failed
        assertEquals("you seem to be offline", l.reason)
        fetch()
        assertEquals("no retry storm while offline", 1, calls.get())
        now += OnlineIndex.RETRY_MS + 1
        fetch()
        assertEquals(2, calls.get())
    }

    fun testOfflineAfterASuccessKeepsUsingTheLastGoodCopy() {
        fetch()
        now += OnlineIndex.FRESH_MS + 1
        respond = { throw IOException("connection reset") }
        val l = fetch()
        assertTrue(l is OnlineIndex.Lookup.Failed)
        assertEquals("abs", l.findAnimation(key, candidates)?.animation?.title)
        // and a new IDE session (fresh client, same disk cache) still has the good copy
        val restarted = OnlineIndex().also { it.cacheDir = index.cacheDir; it.clock = { now } }
        assertEquals("abs", restarted.cached(base, key)?.findAnimation(key, candidates)?.animation?.title)
    }

    fun testCacheSurvivesRestartWithoutNetwork() {
        fetch()
        val restarted = OnlineIndex().also {
            it.cacheDir = index.cacheDir; it.clock = { now }
            it.fetcher = OnlineIndex.Fetcher { _, _ -> error("must not be called") }
        }
        assertFalse(restarted.needsFetch(base, key))
        assertEquals("abs", restarted.cached(base, key)?.findAnimation(key, candidates)?.animation?.title)
    }

    fun testCorruptCacheFilesAreIgnoredAndRemoved() {
        fetch()
        Files.list(index.cacheDir).use { s -> s.forEach { Files.writeString(it, "{ not json") } }
        val restarted = OnlineIndex().also { it.cacheDir = index.cacheDir; it.clock = { now } }
        assertNull(restarted.cached(base, key))
        assertEquals(0L, Files.list(index.cacheDir).use { it.count() })
    }

    fun testBrokenIndexFileIsReportedAndDoesNotReplaceAGoodCopy() {
        fetch()
        now += OnlineIndex.FRESH_MS + 1
        respond = { "<html>maintenance</html>" }
        val l = fetch()
        assertTrue(l is OnlineIndex.Lookup.Failed)
        assertEquals("abs", l.findAnimation(key, candidates)?.animation?.title)
        assertTrue(service<PonderDiagnostics>().snapshot().any { it.message.contains("not valid JSON") })
    }

    fun testVersionRangesAreRespected() {
        respond = { indexBody(versions = "<1.0") }
        assertNull("1.2.0 is outside <1.0", fetch().findAnimation(key, candidates))
        val unknownVersion = key.copy(version = null)
        index.clearCache(); calls.set(0)
        assertNull("unknown installed version never matches a ranged file", fetch(unknownVersion).findAnimation(unknownVersion, candidates))
        respond = { indexBody(versions = null) }
        index.clearCache()
        assertNotNull("a file without a range applies to every version", fetch(unknownVersion).findAnimation(unknownVersion, candidates))
    }

    fun testAFileForAnotherPackageIsNeverUsed() {
        respond = { indexBody().replace("\"name\": \"mathutils\", \"documents\"", "\"name\": \"evil\", \"documents\"") }
        val l = fetch()
        assertNull(l.findAnimation(key, candidates))
    }

    fun testUnsafePackageNamesNeverReachTheNetwork() {
        val bad = key.copy(name = "../../etc/passwd")
        val l = fetch(bad)
        assertTrue(l is OnlineIndex.Lookup.Failed)
        assertEquals(0, calls.get())
        assertFalse(index.needsFetch(base, bad))
    }

    fun testInsecureIndexAddressIsRefused() {
        val l = ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch("http://evil.example/", key) }).get()
        assertTrue(l is OnlineIndex.Lookup.Failed)
        assertEquals(0, calls.get())
    }

    fun testConcurrentLookupsForOnePackageShareOneRequest() {
        val gate = CountDownLatch(1)
        respond = { gate.await(5, TimeUnit.SECONDS); indexBody() }
        val pool = Executors.newFixedThreadPool(8)
        try {
            val futures = (1..8).map { pool.submit(Callable { index.fetch(base, key) }) }
            Thread.sleep(200)
            gate.countDown()
            futures.forEach { assertNotNull(it.get(20, TimeUnit.SECONDS).findAnimation(key, candidates)) }
        } finally {
            pool.shutdownNow()
        }
        assertEquals(1, calls.get())
    }

    fun testStaleCopyIsRefreshedInTheBackgroundForNextTime() {
        fetch()
        index.refreshInBackground(base, key) // fresh: nothing to do
        Thread.sleep(200)
        assertEquals(1, calls.get())

        now += OnlineIndex.FRESH_MS + 1
        val done = CountDownLatch(1)
        respond = { indexBody(title = "abs, fixed").also { done.countDown() } }
        index.refreshInBackground(base, key) // called on the UI thread: must not block or throw
        assertTrue(done.await(10, TimeUnit.SECONDS))
        val deadline = System.currentTimeMillis() + 10_000
        while (index.needsFetch(base, key) && System.currentTimeMillis() < deadline) Thread.sleep(20)
        assertEquals("abs, fixed", index.cached(base, key)?.findAnimation(key, candidates)?.animation?.title)
    }

    fun testFailedBackgroundRefreshKeepsTheCachedAnimation() {
        fetch()
        now += OnlineIndex.FRESH_MS + 1
        val done = CountDownLatch(1)
        respond = { done.countDown(); throw java.net.UnknownHostException("index.test") }
        index.refreshInBackground(base, key)
        assertTrue(done.await(10, TimeUnit.SECONDS))
        val deadline = System.currentTimeMillis() + 10_000
        while (index.cached(base, key) !is OnlineIndex.Lookup.Failed && System.currentTimeMillis() < deadline) Thread.sleep(20)
        assertEquals("abs", index.cached(base, key)?.findAnimation(key, candidates)?.animation?.title)
    }

    fun testALocalTestIndexIsAlwaysRefetched() {
        val local = "http://localhost:8123/"
        ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch(local, key) }).get(20, TimeUnit.SECONDS)
        assertTrue(index.needsFetch(local, key))
        assertTrue(OnlineIndex.isLocalBase("http://127.0.0.1:9000/idx"))
        assertFalse(OnlineIndex.isLocalBase(base))
        assertFalse(OnlineIndex.isLocalBase("https://localhost.example.com/"))
    }

    fun testRefusesToRunOnTheUiThread() {
        try {
            index.fetch(base, key)
            fail("fetch on the UI thread must be refused")
        } catch (e: IllegalStateException) {
            assertEquals(0, calls.get())
        }
    }

    fun testUnexpectedTransportExceptionsBecomeFailures() {
        respond = { throw IllegalArgumentException("boom") }
        val l = fetch()
        assertTrue(l is OnlineIndex.Lookup.Failed)
    }
}
