package dev.ponder

import dev.ponder.matching.MatchOutcome
import dev.ponder.resolution.Provenance
import dev.ponder.testing.PonderTestBase

/** A language without JVM support (JavaScript) going through the generic resolver. */
class GenericResolverTest : PonderTestBase() {

    private fun ponderJson(library: String, vararg symbols: Pair<String, String>) = """
        {
          "version": 1,
          "library": { "name": "$library" },
          "animations": {
            ${symbols.joinToString(",\n") { (id, s) -> """"$id": { "symbol": "$s", "title": "$id", "actors": { "x": { "type": "circle", "radius": 5 } }, "slides": [ {}, { "changes": { "x": { "x": 9 } } } ] }""" }}
          }
        }
    """.trimIndent()

    override fun setUp() {
        super.setUp()
        myFixture.addFileToProject("lib/math-utils/package.json", """{ "name": "math-utils", "version": "1.0.0" }""")
        myFixture.addFileToProject("lib/math-utils/ponder.json", ponderJson("math-utils",
            "clamp" to "js:math-utils#clamp", "push" to "js:math-utils#IntStack.push"))
        myFixture.addFileToProject("lib/math-utils/index.js", """
            export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
            export function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }
        """.trimIndent())
        myFixture.addFileToProject("lib/math-utils/lib/stack.js", """
            export class IntStack {
              push(value) { this.top = value; }
            }
        """.trimIndent())
    }

    fun testFunctionInAPackageMatches() {
        val m = outcomeAt("main.js", """
            import { clamp } from './lib/math-utils/index.js';
            cl<caret>amp(-4, 0, 10);
        """.trimIndent()).found()
        assertEquals("clamp", m.animation.id)
        assertEquals("js:math-utils#clamp", m.symbol.signature)
        assertTrue(m.symbol.provenance is Provenance.Package)
        assertTrue("sym:index.js:clamp" in m.symbol.candidates)
    }

    fun testMethodInAClassInASubfolderMatches() {
        val m = outcomeAt("main.js", """
            import { IntStack } from './lib/math-utils/lib/stack.js';
            new IntStack().pu<caret>sh(3);
        """.trimIndent()).found()
        assertEquals("push", m.animation.id)
    }

    fun testFunctionWithoutAnimation() {
        val r = outcomeAt("main.js", """
            import { gcd } from './lib/math-utils/index.js';
            g<caret>cd(4, 6);
        """.trimIndent()).notFound()
        assertEquals(MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED, r.reason)
    }

    fun testLocalFunctionWithTheSameName() {
        val r = outcomeAt("main.js", """
            function clamp(v, a, b) { return v; }
            cl<caret>amp(-4, 0, 10);
        """.trimIndent()).notFound()
        assertEquals(MatchOutcome.Reason.NO_METADATA, r.reason)
    }

    fun testPackageNameMismatchIsRejected() {
        myFixture.addFileToProject("lib/other/package.json", """{ "name": "other" }""")
        myFixture.addFileToProject("lib/other/ponder.json", ponderJson("math-utils", "clamp" to "js:other#clamp"))
        myFixture.addFileToProject("lib/other/index.js", "export function clamp(v) { return v; }")
        val r = outcomeAt("main.js", """
            import { clamp } from './lib/other/index.js';
            cl<caret>amp(1);
        """.trimIndent()).notFound()
        assertEquals(MatchOutcome.Reason.LIBRARY_MISMATCH, r.reason)
    }

    fun testNotOnAName() {
        val r = outcomeAt("main.js", "const x = 1;<caret>\n").notFound()
        assertEquals(MatchOutcome.Reason.NOT_APPLICABLE, r.reason)
    }
}
