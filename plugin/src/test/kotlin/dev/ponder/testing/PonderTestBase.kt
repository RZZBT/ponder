package dev.ponder.testing

import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.components.service
import com.intellij.testFramework.PsiTestUtil
import com.intellij.testFramework.fixtures.LightJavaCodeInsightFixtureTestCase
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.PonderRegistry
import dev.ponder.matching.PonderService
import java.nio.file.Path

abstract class PonderTestBase : LightJavaCodeInsightFixtureTestCase() {

    override fun setUp() {
        super.setUp()
        service<PonderDiagnostics>().clear()
        project.service<PonderRegistry>().invalidateAll()
    }

    /** Registers a jar as a library of the test module, named like the IDE names Gradle libraries. */
    protected fun addLibrary(libraryName: String, jar: Path) {
        PsiTestUtil.addLibrary(testRootDisposable, module, libraryName, jar.parent.toString(), jar.fileName.toString())
    }

    /** Configures a file containing a `<caret>` marker and runs the full Ponder pipeline at the caret. */
    protected fun outcomeAt(fileName: String, textWithCaret: String): MatchOutcome {
        myFixture.configureByText(fileName, textWithCaret)
        return outcomeAtCaret()
    }

    protected fun outcomeAtCaret(): MatchOutcome = runReadActionBlocking {
        project.service<PonderService>().findAt(myFixture.file, myFixture.caretOffset)
    }

    protected fun MatchOutcome.found(): dev.ponder.matching.PonderMatch =
        (this as? MatchOutcome.Found)?.match ?: error("Expected a Ponder match but got $this")

    protected fun MatchOutcome.notFound(): MatchOutcome.NotFound =
        this as? MatchOutcome.NotFound ?: error("Expected NO match but got ${(this as MatchOutcome.Found).match.animation.id} (${this.match.symbol.signature})")

    protected val diagnostics get() = service<PonderDiagnostics>().snapshot()
}
