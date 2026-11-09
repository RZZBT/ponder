package dev.ponder

import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.projectRoots.Sdk
import com.intellij.testFramework.LightProjectDescriptor
import com.intellij.testFramework.fixtures.DefaultLightProjectDescriptor
import dev.ponder.matching.MatchOutcome
import dev.ponder.resolution.PonderSymbolResolver
import dev.ponder.testing.PonderTestBase
import java.nio.file.Files
import java.nio.file.Path

/**
 * Runs the shipped demo (the math-utils jar and Main.java from examples/consumer) through the full
 * pipeline, with the caret where a person would actually put it.
 */
open class DemoProjectTest : PonderTestBase() {
    private val repo: Path = Path.of(System.getProperty("ponder.repoRoot") ?: error("ponder.repoRoot not set"))
    private val main: String = Files.readString(repo.resolve("examples/consumer/src/main/java/demo/Main.java"))

    override fun setUp() {
        super.setUp()
        // A fresh copy per run: the test IDE caches jar contents by path, so a rebuilt demo jar would otherwise look stale.
        val dir = Files.createTempDirectory("ponder-demo")
        val jar = Files.copy(repo.resolve("examples/consumer/libs/math-utils-1.0.0.jar"), dir.resolve("math-utils-1.0.0.jar"))
        com.intellij.openapi.vfs.newvfs.impl.VfsRootAccess.allowRootAccess(testRootDisposable, repo.toString(), dir.toString())
        addLibrary("math-utils", jar)
    }

    /** Puts the caret [delta] characters after the start of [marker] in Main.java and runs Ponder there. */
    private fun at(marker: String, delta: Int): MatchOutcome {
        val i = main.indexOf(marker)
        check(i >= 0) { "marker '$marker' not in Main.java" }
        val p = i + delta
        return outcomeAt("Main.java", main.substring(0, p) + "<caret>" + main.substring(p))
    }

    fun testCaretInsideName() {
        assertEquals("clamp-int", at("MathUtils.clamp(-4", "MathUtils.cl".length).found().animation.id)
    }

    fun testCaretRightBeforeParenthesis() { // the editor reports the '(' token here; the name is one character back
        assertEquals("clamp-int", at("MathUtils.clamp(-4", "MathUtils.clamp".length).found().animation.id)
    }

    fun testCaretAtStartOfName() {
        assertEquals("clamp-int", at("MathUtils.clamp(-4", "MathUtils.".length).found().animation.id)
    }

    fun testLocalMethodWithSameNameShowsNothing() {
        at("= clamp(-4", "= cl".length).notFound()
    }

    fun testOverloadWithoutAnimationShowsNothing() {
        assertEquals(MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED, at("MathUtils.clamp(1.5", "MathUtils.cl".length).notFound().reason)
    }

    /** "Copy Ponder Symbol" at [marker]+[delta]: the string an author pastes into ponder.json. */
    private fun copiedSymbol(marker: String, delta: Int): String? {
        val p = main.indexOf(marker) + delta
        myFixture.configureByText("Main.java", main.substring(0, p) + "<caret>" + main.substring(p))
        return runReadActionBlocking {
            PonderSymbolResolver.methodForAuthoring(myFixture.file, myFixture.caretOffset)
                ?.let { PonderSymbolResolver.symbolString(it) }
        }
    }

    fun testCopySymbolFromLibraryCall() {
        assertEquals("com.example.math.MathUtils#clamp(int,int,int)", copiedSymbol("MathUtils.clamp(-4", "MathUtils.cl".length))
    }

    fun testCopySymbolFromDeclaration() {
        assertEquals("demo.Main#clamp(int,int,int)", copiedSymbol("static int clamp(", "static int cl".length))
    }

    fun testCopySymbolMatchesWhatPonderLooksUp() { // the copied string is exactly what matching uses
        assertEquals(copiedSymbol("MathUtils.clamp(-4", "MathUtils.cl".length), at("MathUtils.clamp(-4", "MathUtils.cl".length).found().symbol.signature)
    }

    /** Every call in the showcase opens its own animation (static, String parameter, array parameter, constructor, instance). */
    fun testEveryShowcaseCallHasItsAnimation() {
        val expected = linkedMapOf(
            "MathUtils.isBetween(" to "is-between",
            "MathUtils.gcd(" to "gcd",
            "Search.binarySearch(" to "binary-search",
            "Strings.isPalindrome(" to "palindrome",
            "Sorting.insertionSort(" to "insertion-sort",
            "Recursion.factorial(" to "factorial",
            "new IntStack(" to "stack-new",
            "stack.push(5)" to "stack-push",
            "stack.pop()" to "stack-pop",
        )
        for ((marker, animation) in expected) {
            val delta = marker.indexOf('.').let { if (marker.startsWith("new ")) "new In".length else it + 2 }
            assertEquals("at $marker", animation, at(marker, delta).found().animation.id)
        }
    }

    fun testUnrelatedJdkMethodShowsNothing() {
        at("Math.abs(-3)", "Math.ab".length).notFound()
    }
}

/** Same checks in a project without a JDK. */
class DemoProjectWithoutJdkTest : DemoProjectTest() {
    override fun getProjectDescriptor(): LightProjectDescriptor = NO_JDK

    // Math.abs cannot resolve without a JDK; nothing to show is still the right answer, covered by the parent test.

    private companion object {
        val NO_JDK = object : DefaultLightProjectDescriptor() {
            override fun getSdk(): Sdk? = null
        }
    }
}
