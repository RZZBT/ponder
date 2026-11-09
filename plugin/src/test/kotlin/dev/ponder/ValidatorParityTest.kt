package dev.ponder

import com.google.gson.JsonParser
import dev.ponder.discovery.LibraryCoordinatesDetector
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.discovery.LibraryVerdict
import dev.ponder.discovery.MavenCoordinates
import dev.ponder.format.LibraryDecl
import dev.ponder.format.PonderLimits
import dev.ponder.format.PonderValidator
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Runs schema/fixtures/index.json (also used by engine/tests/fixtures.test.ts) against the Kotlin validator,
 * so the IDE side and the renderer side accept and reject exactly the same documents with the same error paths.
 */
class ValidatorParityTest {

    private val dir = File(System.getProperty("ponder.repoRoot") ?: error("ponder.repoRoot not set"), "schema/fixtures")

    @Test
    fun sharedFixturesAgreeWithTheEngineValidator() {
        val index = JsonParser.parseString(File(dir, "index.json").readText()).asJsonArray
        assertTrue(index.size() > 20)
        for (c in index) {
            val o = c.asJsonObject
            val file = o["file"].asString
            val report = PonderValidator.validate(File(dir, file).readText())
            assertEquals("$file: ${report.errors}", o["valid"].asBoolean, report.ok)
            for (e in o["errors"].asJsonArray) {
                val path = e.asJsonObject["path"].asString
                val contains = e.asJsonObject["messageContains"].asString
                assertTrue(
                    "$file: expected an error at $path containing \"$contains\" but got ${report.errors}",
                    report.errors.any { it.path == path && it.message.contains(contains) },
                )
            }
        }
    }

    @Test
    fun extractsMetadataFromTheDemo() {
        val text = File(dir, "../../examples/math-utils/src/main/resources/META-INF/ponder/ponder.json").readText()
        val doc = PonderValidator.validate(text).document
        assertNotNull(doc)
        assertEquals(LibraryDecl("com.example", "math-utils", null), doc!!.library)
        val a = doc.find("com.example.math.MathUtils#clamp(int,int,int)")
        assertNotNull(a)
        assertEquals("clamp-int", a!!.id)
        assertEquals("How clamp() works", a.title)
        // exact signatures only
        assertNull(doc.find("com.example.math.MathUtils#clamp(double,double,double)"))
        assertNull(doc.find("com.example.math.MathUtils#clamp"))
        assertNull(doc.find("clamp"))
        assertNull(doc.find("MathUtils#clamp(int,int,int)"))
    }

    @Test
    fun aliasesBindTheSameAnimation() {
        val json = """{"version":1,"library":{"group":"g","name":"n"},"animations":{"a":{"symbol":"p.C#m(int)","aliases":["p.D#m(int)"],"title":"t","actors":{"x":{"type":"circle"}},"slides":[{"id":"s"}]}}}"""
        val doc = PonderValidator.validate(json).document!!
        assertEquals("a", doc.find("p.D#m(int)")!!.id)
        assertEquals("a", doc.find("p.C#m(int)")!!.id)
    }

    @Test
    fun hostileInputNeverThrows() {
        val hostile = listOf(
            "", " ", "null", "[]", "{", "}", "\"x\"", "\u0000", "{\"version\":1}",
            "[".repeat(200_000), "{\"a\":".repeat(100_000), "{" + "\"k\":1,".repeat(50_000) + "\"z\":1}",
            "x".repeat(PonderLimits.MAX_FILE_BYTES + 1),
            "{\"version\":1,\"library\":{},\"animations\":{\"__proto__\":{}}}",
            "{\"version\":1,\"library\":{\"group\":\"g\",\"name\":\"n\"},\"animations\":{\"a\":{\"symbol\":\"p.C#m()\",\"title\":\"t\",\"actors\":{\"x\":{\"type\":\"polygon\",\"points\":[[0,\"a\"],[1],7]}},\"slides\":[{}]}}}",
        )
        for (h in hostile) {
            val r = PonderValidator.validate(h) // must not throw, must not be ok
            assertFalse("should be rejected: ${h.take(40)}", r.ok)
            assertTrue(r.errors.isNotEmpty())
        }
    }

    @Test
    fun symbolGrammar() {
        listOf("a.B#c()", "Main#run()", "a.B#<init>(java.lang.String,int[])", "a.B.Inner#m(java.util.List)", "a.B#m(double[][])")
            .forEach { assertTrue(it, PonderValidator.isValidSymbol(it)) }
        listOf("clamp", "a.B#c(int, int)", "a.B#c(String)", "a.B#c(", "a.B#(int)", "a.B#c(int)x", "")
            .forEach { assertFalse(it, PonderValidator.isValidSymbol(it)) }
    }

    // library identity helpers

    @Test
    fun parsesLibraryNames() {
        assertEquals(MavenCoordinates("com.example", "math-utils", "1.0.0"), LibraryCoordinatesDetector.parseLibraryName("Gradle: com.example:math-utils:1.0.0"))
        assertEquals(MavenCoordinates("com.example", "math-utils", "1.0.0"), LibraryCoordinatesDetector.parseLibraryName("Maven: com.example:math-utils:1.0.0"))
        assertEquals(MavenCoordinates("g", "a", "1"), LibraryCoordinatesDetector.parseLibraryName("Gradle: g:a:1:sources"))
        assertNull(LibraryCoordinatesDetector.parseLibraryName("math-utils-1.0.0.jar")) // a file name is not evidence
        assertNull(LibraryCoordinatesDetector.parseLibraryName(null))
        assertNull(LibraryCoordinatesDetector.parseLibraryName("Gradle: only:two"))
    }

    @Test
    fun parsesPomProperties() {
        assertEquals(MavenCoordinates("g", "a", "2.0"), LibraryCoordinatesDetector.parsePomProperties("#generated\ngroupId=g\nartifactId=a\nversion=2.0\n"))
        assertNull(LibraryCoordinatesDetector.parsePomProperties("artifactId=a"))
        assertNull(LibraryCoordinatesDetector.parsePomProperties("garbage"))
    }

    @Test
    fun verificationPolicy() {
        val decl = LibraryDecl("com.example", "math-utils", null)
        fun ev(vararg c: MavenCoordinates, source: LibraryEvidence.Source = LibraryEvidence.Source.POM_PROPERTIES) = LibraryEvidence(c.toList(), source)

        assertEquals(LibraryVerdict.Verified(LibraryEvidence.Source.POM_PROPERTIES), LibraryCoordinatesDetector.verify(decl, ev(MavenCoordinates("com.example", "math-utils", "1.0"))))
        // fat jar with several poms: any matching one verifies
        assertTrue(LibraryCoordinatesDetector.verify(decl, ev(MavenCoordinates("x", "y", "1"), MavenCoordinates("com.example", "math-utils", "1"))) is LibraryVerdict.Verified)
        assertTrue(LibraryCoordinatesDetector.verify(decl, ev(MavenCoordinates("com.other", "thing", "1"))) is LibraryVerdict.Mismatch)
        assertTrue(LibraryCoordinatesDetector.verify(decl, ev(MavenCoordinates("com.example", "other", "1"))) is LibraryVerdict.Mismatch)
        assertEquals(LibraryVerdict.Unverifiable, LibraryCoordinatesDetector.verify(decl, LibraryEvidence(emptyList(), LibraryEvidence.Source.NONE)))
        // version differences are not a mismatch (informational only)
        assertTrue(LibraryCoordinatesDetector.verify(decl.copy(version = "9"), ev(MavenCoordinates("com.example", "math-utils", "1"))) is LibraryVerdict.Verified)
    }
}
