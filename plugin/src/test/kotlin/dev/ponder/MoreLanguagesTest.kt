package dev.ponder

import dev.ponder.matching.MatchOutcome.Reason
import dev.ponder.testing.PonderTestBase
import dev.ponder.testing.TestLibs
import dev.ponder.testing.TestLibs.ponderJson

/** Groovy (JVM symbols through UAST) and TypeScript (generic resolver), next to the Java, Kotlin and JS tests. */
class MoreLanguagesTest : PonderTestBase() {

    private fun jvmLib() = TestLibs.buildJar(
        TestLibs.tempDir("groovylib"), "math-utils-1.0.0.jar",
        mapOf("com/example/math/MathUtils.java" to """
            package com.example.math;
            public final class MathUtils {
                public static int clamp(int v, int a, int b) { return v; }
                public static double clamp(double v, double a, double b) { return v; }
            }""".trimIndent()),
        mapOf("META-INF/ponder/ponder.json" to ponderJson("com.example", "math-utils", Triple("clamp-int", "com.example.math.MathUtils#clamp(int,int,int)", "G"))),
        Triple("com.example", "math-utils", "1.0.0"),
    )

    fun testGroovyCallToLibraryMethod() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", jvmLib())
        val m = outcomeAt("Main.groovy", "import com.example.math.MathUtils\nint x = MathUtils.<caret>clamp(5, 0, 10)").found()
        assertEquals("clamp-int", m.animation.id)
        assertEquals("com.example.math.MathUtils#clamp(int,int,int)", m.symbol.signature)
    }

    fun testGroovyOverloadIsNotMatched() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", jvmLib())
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED,
            outcomeAt("A.groovy", "import com.example.math.MathUtils\ndouble x = MathUtils.<caret>clamp(5.0d, 0.0d, 10.0d)").notFound().reason)
    }

    private fun tsLib() {
        myFixture.addFileToProject("ts-math/package.json", """{ "name": "ts-math" }""")
        myFixture.addFileToProject("ts-math/ponder.json", """
            { "version": 1, "library": { "name": "ts-math" }, "animations": {
              "clamp": { "symbol": "js:ts-math#clamp", "title": "clamp", "actors": { "x": { "type": "circle", "radius": 5 } }, "slides": [ {}, { "changes": { "x": { "x": 9 } } } ] },
              "push": { "symbol": "js:ts-math#IntStack.push", "title": "push", "actors": { "x": { "type": "circle", "radius": 5 } }, "slides": [ {}, { "changes": { "x": { "x": 9 } } } ] }
            } }
        """.trimIndent())
        myFixture.addFileToProject("ts-math/index.ts", """
            export function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
            export class IntStack {
              private items: number[] = [];
              push(value: number): void { this.items.push(value); }
            }
        """.trimIndent())
    }

    fun testTypeScriptFunction() {
        tsLib()
        val m = outcomeAt("main.ts", "import { clamp } from './ts-math/index';\nconst a = cl<caret>amp(-4, 0, 10);").found()
        assertEquals("clamp", m.animation.id)
    }

    fun testTypeScriptMethod() {
        tsLib()
        val m = outcomeAt("main.ts", "import { IntStack } from './ts-math/index';\nnew IntStack().pu<caret>sh(3);").found()
        assertEquals("push", m.animation.id)
    }

    fun testTypeScriptLocalFunction() {
        tsLib()
        assertEquals(Reason.NO_METADATA,
            outcomeAt("main.ts", "function clamp(v: number) { return v; }\nconst a = cl<caret>amp(1);").notFound().reason)
    }
}
