package dev.ponder

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.ponder.sources.IndexProtocol
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Runs schema/conformance/index.json, the same cases as engine/tests/index-protocol.test.ts. */
class IndexProtocolTest {
    private val cases: JsonObject = JsonParser.parseString(
        File(System.getProperty("ponder.repoRoot") ?: error("ponder.repoRoot not set"), "schema/conformance/index.json").readText(),
    ).asJsonObject

    private fun JsonObject.str(k: String): String? = get(k)?.takeIf { !it.isJsonNull }?.asString

    @Test
    fun paths() {
        for (c in cases["paths"].asJsonArray.map { it.asJsonObject }) {
            assertEquals("${c.str("ecosystem")} ${c.str("name")}", c.str("path"), IndexProtocol.indexPath(c.str("ecosystem")!!, c.str("name")!!))
        }
    }

    @Test
    fun versions() {
        for (c in cases["versions"].asJsonArray.map { it.asJsonObject }) {
            assertEquals("${c.str("version")} in ${c.str("range")}", c["in"].asBoolean, IndexProtocol.versionInRange(c.str("version"), c.str("range")))
        }
    }

    @Test
    fun baseUrls() {
        for (c in cases["baseUrls"].asJsonArray.map { it.asJsonObject }) {
            assertEquals(c.str("raw"), c.str("normalized"), IndexProtocol.normalizeBaseUrl(c.str("raw")!!))
        }
    }

    @Test
    fun indexFiles() {
        for (c in cases["indexFiles"].asJsonArray.map { it.asJsonObject }) {
            val key = c["key"].asJsonObject
            val text = c.str("text") ?: c["json"].toString()
            val r = IndexProtocol.parseIndexFile(text, key.str("ecosystem")!!, key.str("name")!!)
            val name = c.str("name")
            assertEquals("$name: ok", c["ok"].asBoolean, r.ok)
            assertEquals("$name: documents ${r.problems}", c["documents"].asInt, r.documents.size)
            c.str("problemContains")?.let { assertTrue("$name: ${r.problems}", r.problems.joinToString("\n").contains(it)) }
            r.documents.forEach { JsonParser.parseString(it.text) }
        }
    }

    @Test
    fun hostileInputNeverThrows() {
        val hostile = listOf(
            "", "null", "[]", "{", "\"x\"", "1",
            """{"ponderIndex":1,"ecosystem":"npm","name":"x","documents":[null,1,[],{"ponder":[]}]}""",
            "[".repeat(200_000), "{\"a\":".repeat(100_000), "x".repeat(3 * 1024 * 1024),
        )
        for (h in hostile) assertFalse(IndexProtocol.parseIndexFile(h, "npm", "x").documents.isNotEmpty())
    }
}
