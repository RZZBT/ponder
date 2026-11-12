package dev.ponder

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.ponder.sources.IndexProtocol
import dev.ponder.sources.StdLibrary
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Runs schema/conformance/stdlib.json, the same cases as engine/tests/stdlib.test.ts. */
class StdLibraryTest {
    private val cases = JsonParser.parseString(
        File(System.getProperty("ponder.repoRoot") ?: error("ponder.repoRoot not set"), "schema/conformance/stdlib.json").readText(),
    ).asJsonObject["cases"].asJsonArray.map { it.asJsonObject }

    @Test
    fun sharedCases() {
        assertTrue(cases.size > 25)
        for (c in cases) {
            val name = c["name"].asString
            val r = StdLibrary.recognize(c["path"].asString, c["names"].asJsonArray.map { it.asString })
            val expect = c["expect"]
            if (expect == null || expect.isJsonNull) {
                assertNull(name, r)
                continue
            }
            val e = expect.asJsonObject
            assertNotNull(name, r)
            assertEquals(name, e["key"].asString, r!!.keyName)
            assertEquals(name, e["version"]?.takeIf { !it.isJsonNull }?.asString, r.version)
            assertEquals(name, e["candidates"].asJsonArray.map { it.asString }, r.candidates)
            assertEquals(name, "v1/std/${r.keyName}.json", IndexProtocol.indexPath("std", r.keyName))
        }
    }

    @Test
    fun jdkClasses() {
        val r = StdLibrary.forJdk("java.util", listOf("java.util.ArrayList#add(java.lang.Object)"), "java version \"21.0.2\"")!!
        assertEquals("java/java.util", r.keyName)
        assertEquals("21.0.2", r.version)
        assertEquals("v1/std/java/java.util.json", IndexProtocol.indexPath("std", r.keyName))
        assertNull(StdLibrary.forJdk("", listOf("x"), null))
        assertEquals(null, StdLibrary.forJdk("java.lang", listOf("java.lang.Math#abs(int)"), null)!!.version)
    }

    @Test
    fun labelsAndOddInput() {
        assertEquals("Python standard library (builtins)", IndexProtocol.describePackage("std", "python/builtins"))
        assertEquals("pypi/numpy", IndexProtocol.describePackage("pypi", "numpy"))
        assertEquals("1.22.3", StdLibrary.goVersionFromFile("go1.22.3\ntime x\n"))
        for (p in listOf("", "/", "\\\\server\\share\\", "typeshed/stdlib/.pyi", "/go/src/.go", "x".repeat(5000))) {
            StdLibrary.recognize(p, listOf("f")) // must not throw
        }
        assertNull(StdLibrary.recognize("/x/typeshed/stdlib/builtins.pyi", listOf("bad name")))
    }

    @Suppress("unused")
    private fun JsonObject.str(k: String): String? = get(k)?.takeIf { !it.isJsonNull }?.asString
}
