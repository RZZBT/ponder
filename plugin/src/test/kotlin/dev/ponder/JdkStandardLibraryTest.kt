package dev.ponder

import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.projectRoots.JavaSdk
import com.intellij.openapi.projectRoots.ProjectJdkTable
import com.intellij.openapi.projectRoots.Sdk
import com.intellij.openapi.roots.ModuleRootModificationUtil
import dev.ponder.matching.MatchOutcome
import dev.ponder.resolution.Provenance
import dev.ponder.testing.PonderTestBase

/**
 * Ponder 0.3: a call into the JDK is Java's standard library. Uses the real JDK that runs the build (ponder.jdkHome),
 * registered for this test only.
 */
class JdkStandardLibraryTest : PonderTestBase() {
    private var jdk: Sdk? = null

    override fun setUp() {
        super.setUp()
        val home = System.getProperty("ponder.jdkHome") ?: error("ponder.jdkHome not set")
        val sdk = JavaSdk.getInstance().createJdk("ponder-test-jdk", home, false)
        WriteAction.runAndWait<Throwable> { ProjectJdkTable.getInstance().addJdk(sdk) }
        ModuleRootModificationUtil.setModuleSdk(module, sdk)
        jdk = sdk
    }

    override fun tearDown() {
        try {
            ModuleRootModificationUtil.setModuleSdk(module, null)
            jdk?.let { sdk -> WriteAction.runAndWait<Throwable> { ProjectJdkTable.getInstance().removeJdk(sdk) } }
        } catch (e: Throwable) {
            addSuppressedException(e)
        } finally {
            jdk = null
            super.tearDown()
        }
    }

    fun testAJdkMethodIsJavasStandardLibrary() {
        val outcome = outcomeAt("Example.java", "class Example { int t() { return Math.<caret>abs(-3); } }")
        val notFound = outcome as? MatchOutcome.NotFound ?: error("expected no animation yet, got $outcome")
        assertEquals("problem: ${notFound.problem?.id} detail: ${notFound.detail}", MatchOutcome.Reason.NO_METADATA, notFound.reason)
        val key = notFound.packageKey ?: error("no key: ${notFound.detail}")
        assertEquals("std", key.ecosystem)
        assertEquals("java/java.lang", key.name)
        assertNotNull("the JDK version is known", key.version)
        assertTrue(key.version!!.matches(Regex("\\d+(\\.\\d+)*")))
        val provenance = notFound.symbol!!.provenance as Provenance.StandardLibrary
        assertEquals("java", provenance.language)
        assertEquals("java.lang.Math#abs(int)", notFound.symbol!!.signature)
    }

    fun testCollectionsUseTheirPackage() {
        val outcome = outcomeAt("Example.java", "import java.util.*; class Example { void t() { List<String> l = new ArrayList<>(); l.<caret>add(\"x\"); } }")
        val key = (outcome as MatchOutcome.NotFound).packageKey ?: error("no key: ${outcome.detail}")
        assertEquals("java/java.util", key.name)
        assertEquals("java.util.List#add(java.lang.Object)", outcome.symbol!!.signature)
    }

}
