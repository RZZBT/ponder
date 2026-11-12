package dev.ponder

import com.intellij.openapi.application.runReadAction
import dev.ponder.matching.MatchOutcome
import dev.ponder.resolution.PonderResolver
import dev.ponder.resolution.Provenance
import dev.ponder.sources.PackageKeys
import dev.ponder.testing.PonderTestBase

/**
 * Privacy: code that is part of the user's own project must never get a package key, because a package key is what
 * gets sent to the online index (and what local files are matched against). Dependencies do get one.
 */
class OwnCodePrivacyTest : PonderTestBase() {

    fun testOwnPackageIsNeverIdentifiedForOnlineLookup() {
        myFixture.addFileToProject("app/package.json", """{ "name": "my-secret-internal-app", "version": "1.0.0" }""")
        myFixture.addFileToProject("app/util.js", "export function clamp(v, a, b) { return v; }")
        val r = outcomeAt("main.js", "import { clamp } from './app/util.js';\ncl<caret>amp(1, 2, 3);").notFound()

        // make sure this resolved to the user's own package (so the test fails for the right reason if it breaks)
        val provenance = runReadAction {
            PonderResolver.forFile(myFixture.file)!!.resolveAt(myFixture.file, myFixture.caretOffset)!!.identity.provenance
        } as Provenance.Package
        assertEquals("my-secret-internal-app", provenance.manifestName)
        assertEquals(MatchOutcome.Reason.NO_METADATA, r.reason)

        assertNull("the user's own package name must never leave the machine", r.packageKey)
    }

    /*
     * Dependencies. The light test project's JavaScript support does not follow imports into node_modules (real IDEs
     * mark it as a library root), so these check the identification rules on the folders directly.
     */

    fun testDependencyUnderNodeModulesIsIdentifiedEvenInsideTheProject() {
        myFixture.addFileToProject("node_modules/left-pad/package.json", """{ "name": "left-pad", "version": "1.3.0" }""")
        val root = myFixture.findFileInTempDir("node_modules/left-pad")
        runReadAction {
            assertFalse(PackageKeys.isOwnCode(project, root))
            val key = PackageKeys.ofPackageRoot(root, "left-pad")!!
            assertEquals("npm", key.ecosystem)
            assertEquals("left-pad", key.name)
            assertEquals("1.3.0", key.version)
        }
    }

    fun testInstalledPythonPackageIsIdentifiedThroughDistInfo() {
        myFixture.addFileToProject(".venv/lib/site-packages/sklearn/__init__.py", "")
        myFixture.addFileToProject(".venv/lib/site-packages/scikit_learn-1.3.0.dist-info/top_level.txt", "sklearn\n")
        myFixture.addFileToProject(".venv/lib/site-packages/scikit_learn-1.3.0.dist-info/METADATA", "Metadata-Version: 2.1\nName: scikit-learn\nVersion: 1.3.0\n")
        val root = myFixture.findFileInTempDir(".venv/lib/site-packages/sklearn")
        runReadAction {
            assertFalse(PackageKeys.isOwnCode(project, root))
            val key = PackageKeys.ofPackageRoot(root, null)!!
            assertEquals("pypi" to "scikit-learn", key.ecosystem to key.name)
            assertEquals("1.3.0", key.version)
        }
    }

    fun testOwnFolderIsOwnCode() {
        myFixture.addFileToProject("app/package.json", """{ "name": "mine" }""")
        runReadAction { assertTrue(PackageKeys.isOwnCode(project, myFixture.findFileInTempDir("app"))) }
    }
}
