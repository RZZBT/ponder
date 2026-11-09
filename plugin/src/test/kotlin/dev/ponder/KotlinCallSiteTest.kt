package dev.ponder

import dev.ponder.matching.MatchOutcome.Reason
import dev.ponder.testing.PonderTestBase
import dev.ponder.testing.TestLibs
import dev.ponder.testing.TestLibs.ponderJson

/** Kotlin call sites are resolved through UAST to the same JVM-level identity as Java ones. */
class KotlinCallSiteTest : PonderTestBase() {

    private fun lib() = TestLibs.buildJar(
        TestLibs.tempDir("ktlib"), "math-utils-1.0.0.jar",
        mapOf("com/example/math/MathUtils.java" to """
            package com.example.math;
            public final class MathUtils {
                public static int clamp(int v, int a, int b) { return v; }
                public static double clamp(double v, double a, double b) { return v; }
            }""".trimIndent()),
        mapOf("META-INF/ponder/ponder.json" to ponderJson("com.example", "math-utils", Triple("clamp-int", "com.example.math.MathUtils#clamp(int,int,int)", "KT"))),
        Triple("com.example", "math-utils", "1.0.0"),
    )

    fun testKotlinCallToLibraryJavaMethodMatches() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", lib())
        val m = outcomeAt("Main.kt", "import com.example.math.MathUtils\nfun f() = MathUtils.<caret>clamp(5, 0, 10)").found()
        assertEquals("clamp-int", m.animation.id)
    }

    fun testKotlinOverloadAndLocalFunctionAreNotMatched() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", lib())
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED,
            outcomeAt("A.kt", "import com.example.math.MathUtils\nfun f() = MathUtils.<caret>clamp(5.0, 0.0, 10.0)").notFound().reason)
        outcomeAt("B.kt", "fun clamp(v: Int, a: Int, b: Int) = v\nfun g() = <caret>clamp(5, 0, 10)").notFound()
    }
}
