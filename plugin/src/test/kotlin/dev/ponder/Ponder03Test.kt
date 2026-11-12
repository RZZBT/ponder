package dev.ponder

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.matching.PonderProblem
import dev.ponder.matching.PonderProblems
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey
import dev.ponder.sources.findAnimation
import dev.ponder.sources.newerPonderNeeded
import dev.ponder.testing.TestLibs
import dev.ponder.ui.PonderActivation
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit

/** Ponder 0.3: standard-library lookups, the one-hour re-check, Retry now, "update Ponder", and the problem catalogue. */
class Ponder03Test : BasePlatformTestCase() {
    private val base = "https://index.test/"
    private val key = PackageKey("std", "python/builtins", "3.12.4", LibraryEvidence.Source.STANDARD_LIBRARY)
    private val candidates = listOf("py:builtins.sorted", "sym:builtins.pyi:sorted")
    private lateinit var index: OnlineIndex
    private var now = 1_000_000_000L
    private var calls = 0
    private var respond: (String) -> String? = { body("How sorted() works") }

    override fun setUp() {
        super.setUp()
        index = OnlineIndex()
        index.cacheDir = TestLibs.tempDir("ponder-std-cache")
        index.clock = { now }
        index.fetcher = OnlineIndex.Fetcher { url, _ -> calls++; respond(url) }
        service<PonderDiagnostics>().clear()
    }

    private fun doc(title: String, requires: String = "") = """
        { "version": 1, $requires "library": { "name": "python/builtins" },
          "animations": { "sorted": { "symbol": "py:builtins.sorted", "title": "$title",
            "actors": { "d": { "type": "circle" } }, "slides": [ { "caption": "x" } ] } } }
    """.trimIndent()

    private fun body(title: String, versions: String? = ">=3.8", requires: String = "") =
        """{ "ponderIndex": 1, "ecosystem": "std", "name": "python/builtins", "documents": [
             { ${versions?.let { "\"versions\": \"$it\"," } ?: ""} "ponder": ${doc(title, requires)} } ] }"""

    private fun fetch(): OnlineIndex.Lookup =
        ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch(base, key) }).get(20, TimeUnit.SECONDS)

    fun testStandardLibraryLookupUsesTheDocumentedAddressAndAFriendlyLabel() {
        var asked = ""
        respond = { url -> asked = url; body("How sorted() works") }
        val hit = fetch().findAnimation(key, candidates)
        assertEquals("https://index.test/v1/std/python/builtins.json", asked)
        assertEquals("How sorted() works", hit?.animation?.title)
        assertEquals("Community index · Python standard library (builtins)", hit?.source)
        assertEquals("Python standard library (builtins)", key.label)
    }

    fun testLanguageVersionRangesAreRespected() {
        respond = { body("only 3.13+", versions = ">=3.13") }
        assertNull(fetch().findAnimation(key, candidates))
    }

    fun testNoAnimationYetIsCheckedAgainAfterAnHour() {
        respond = { null }
        assertTrue(fetch() is OnlineIndex.Lookup.Absent)
        now += OnlineIndex.ABSENT_MS - 1000
        assertFalse(index.needsFetch(base, key))
        now += 2000
        assertTrue(index.needsFetch(base, key))
        assertTrue(OnlineIndex.ABSENT_MS < OnlineIndex.FRESH_MS)
    }

    fun testRetryNowForgetsAFailureButKeepsAGoodCopy() {
        respond = { throw IOException("offline") }
        assertTrue(fetch() is OnlineIndex.Lookup.Failed)
        assertFalse(index.needsFetch(base, key)) // would wait RETRY_MS
        // a restart must not bring the failure back either
        index.forgetFailure(base, key)
        val restarted = OnlineIndex().also { it.cacheDir = index.cacheDir; it.clock = { now } }
        assertTrue(restarted.needsFetch(base, key))
        assertTrue(index.needsFetch(base, key))

        respond = { body("back online") }
        assertEquals("back online", fetch().findAnimation(key, candidates)?.animation?.title)
        index.forgetFailure(base, key) // a good copy is never forgotten
        assertFalse(index.needsFetch(base, key))
        assertTrue(Files.list(index.cacheDir).use { it.count() } >= 1)
    }

    fun testAnEntryForANewerPonderIsSkippedAndExplained() {
        respond = { body("needs tables", requires = "\"requires\": [\"tables\"],") }
        val lookup = fetch()
        assertNull(lookup.findAnimation(key, candidates))
        assertEquals(
            "This file needs a newer Ponder: it uses \"tables\", which this version does not have. Update Ponder to see this animation.",
            lookup.newerPonderNeeded(),
        )
        assertNull((null as OnlineIndex.Lookup?).newerPonderNeeded())
    }

    // ---------------------------------------------------------------- problems

    private val all = listOf(
        PonderProblems.noName(), PonderProblems.noJdk(),
        PonderProblems.cannotResolve("clip", "python"), PonderProblems.cannotResolve("clamp", "jvm"), PonderProblems.cannotResolve("x", "go"),
        PonderProblems.callHasErrors("max"), PonderProblems.notAFunction("size"), PonderProblems.ownCode("helper"),
        PonderProblems.unsupportedFile(), PonderProblems.unknownLibrary("f", "mylib"),
        PonderProblems.noAnimationYet("sorted", "the Python standard library"), PonderProblems.onlineOff("clip", "'numpy'"),
        PonderProblems.onlineSkipped("clip"), PonderProblems.indexUnreachable("clip", "you seem to be offline"),
        PonderProblems.brokenLibraryFile("mathutils", "$.animations.a: Unknown property \"captoin\"."),
        PonderProblems.libraryMismatch("ponder.json declares library x, but the jar is y"),
        PonderProblems.needsUpdate("This file needs a newer Ponder."), PonderProblems.unexpected(),
    )

    fun testEveryProblemSaysWhatHappenedAndWhatToTry() {
        for (p in all) {
            assertTrue(p.id, p.title.length > 5 && !p.title.endsWith("."))
            assertTrue(p.id, p.detail.length > 20)
            assertTrue(p.id, p.tries.isNotEmpty() && p.tries.all { it.length > 15 })
            assertTrue(p.id, p.longText.contains("Try:\n  1. "))
        }
        val setup = all.filter { it.setup }.map { it.id }.toSet()
        assertTrue(setup.containsAll(setOf("no-jdk", "cannot-resolve", "index-unreachable", "needs-update")))
        assertFalse("no-animation-yet" in setup)
        assertEquals(listOf(PonderProblem.Action.PYTHON_INTERPRETER), PonderProblems.cannotResolve("clip", "python").actions)
        assertEquals(listOf(PonderProblem.Action.RETRY_ONLINE), PonderProblems.indexUnreachable("x", "y").actions)
    }

    fun testNotificationTextIsEscapedAndHasANumberedTryList() {
        // the name appears in the explanation of "cannot resolve"
        val html = PonderActivation.problemHtml(PonderProblems.cannotResolve("<img src=x onerror=alert(1)>", "jvm"))
        assertFalse(html.contains("<img"))
        assertTrue(html.contains("&lt;img src=x onerror=alert(1)&gt;"))
        assertTrue(html.contains("<b>Try:</b><ol><li>"))
        assertTrue(PonderActivation.problemHtml(PonderProblems.noName()).contains("<code>sorted</code>"))
    }
}
