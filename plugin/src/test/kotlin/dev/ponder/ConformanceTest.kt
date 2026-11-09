package dev.ponder

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import dev.ponder.format.AnimationInfo
import dev.ponder.format.LibraryDecl
import dev.ponder.format.PonderDocument
import dev.ponder.format.PonderSymbols
import dev.ponder.packages.PackageLayout
import junit.framework.TestCase
import java.io.File

/** Runs schema/conformance/packages.json, the cases the VS Code extension runs too (vscode/tests/conformance.test.ts). */
class ConformanceTest : TestCase() {

    private val spec: JsonObject by lazy {
        val root = System.getProperty("ponder.repoRoot") ?: error("ponder.repoRoot not set")
        JsonParser.parseString(File(root, "schema/conformance/packages.json").readText()).asJsonObject
    }

    private class FakeDir(val files: Map<String, String>, val path: String) : PackageLayout.Dir {
        override val name get() = path.substringAfterLast('/')
        override val parent: PackageLayout.Dir? get() = if (path.isEmpty()) null else FakeDir(files, path.substringBeforeLast('/', ""))
        private fun full(n: String) = if (path.isEmpty()) n else "$path/$n"
        override fun hasFile(name: String) = full(name) in files
        override fun hasFileMatching(suffix: String) =
            files.keys.any { it.startsWith("$path/") && !it.removePrefix("$path/").contains('/') && it.endsWith(suffix) }
        override fun readText(name: String) = files[full(name)]
    }

    fun testPackages() {
        val failures = ArrayList<String>()
        for (case in spec.getAsJsonArray("packages").map { it.asJsonObject }) {
            val name = case.get("name").asString
            val files = case.getAsJsonObject("files").entrySet().associate { it.key to it.value.asString }
            val decl = case.get("decl").asString
            val names = case.getAsJsonArray("names").map { it.asString }
            val expect = case.getAsJsonObject("expect")

            val root = PackageLayout.findRoot(FakeDir(files, decl.substringBeforeLast('/')))
            val rootPath = (root.dir as FakeDir).path
            val candidates = PackageLayout.candidates(root, decl.removePrefix("$rootPath/"), names)
            fun check(what: String, expected: Any?, actual: Any?) { if (expected != actual) failures += "$name: $what expected $expected, got $actual" }
            check("root", expect.get("root").asString, rootPath)
            check("ponder", expect.get("ponder").takeUnless { it.isJsonNull }?.asString, root.ponderFile)
            expect.get("manifestName")?.let { check("manifestName", it.asString, PackageLayout.manifestName(root)) }
            check("candidates", expect.getAsJsonArray("candidates").map { it.asString }, candidates)
            candidates.filterNot { PonderSymbols.isValid(it) }.forEach { failures += "$name: invalid symbol $it" }
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    fun testMatching() {
        val failures = ArrayList<String>()
        for (case in spec.getAsJsonArray("matching").map { it.asJsonObject }) {
            val symbols = case.getAsJsonArray("symbols").map { it.asString }
            val separate = case.get("separateAnimations")?.asBoolean == true
            val animations = if (separate) symbols.mapIndexed { i, s -> info("a$i", s, emptyList()) }
            else listOf(info("a0", symbols.first(), symbols.drop(1)))
            val doc = PonderDocument(LibraryDecl(null, "n", null), animations, "{}")
            val found = doc.findAny(case.getAsJsonArray("candidates").map { it.asString })?.symbol
            val expected = case.get("expect").takeUnless { it.isJsonNull }?.asString
            if (found != expected) failures += "${case.get("name").asString}: expected $expected, got $found"
        }
        assertTrue(failures.joinToString("\n"), failures.isEmpty())
    }

    private fun info(id: String, symbol: String, aliases: List<String>) = AnimationInfo(id, symbol, aliases, id, "")
}
