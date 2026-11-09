package dev.ponder

import com.intellij.openapi.application.runWriteAction
import com.intellij.openapi.components.service
import com.intellij.openapi.roots.ModuleRootModificationUtil
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtil
import dev.ponder.diagnostics.Severity
import dev.ponder.discovery.LibraryVerdict
import dev.ponder.matching.MatchOutcome.Reason
import dev.ponder.matching.PonderRegistry
import dev.ponder.resolution.Provenance
import dev.ponder.testing.PonderTestBase
import dev.ponder.testing.TestLibs
import dev.ponder.testing.TestLibs.ponderJson
import java.nio.file.Path

/** Matching tests: local vs library methods, same names in two libraries, overloads, missing and invalid metadata, upgrades. */
class PonderMatchingTest : PonderTestBase() {

    private val CLAMP_INT = "com.example.math.MathUtils#clamp(int,int,int)"

    private val mathUtilsSource = mapOf(
        "com/example/math/MathUtils.java" to """
            package com.example.math;
            public final class MathUtils {
                public static int clamp(int value, int min, int max) { return Math.max(min, Math.min(max, value)); }
                public static double clamp(double value, double min, double max) { return Math.max(min, Math.min(max, value)); }
                public static long clamp(long value, long min, long max) { return Math.max(min, Math.min(max, value)); }
                public static boolean isBetween(int v, int lo, int hi) { return v >= lo && v <= hi; }
            }
        """.trimIndent(),
    )

    private fun mathUtilsJar(
        dir: Path = TestLibs.tempDir("ponder-lib"),
        json: String? = ponderJson("com.example", "math-utils", Triple("clamp-int", CLAMP_INT, "int clamp")),
        pom: Triple<String, String, String>? = Triple("com.example", "math-utils", "1.0.0"),
        fileName: String = "math-utils-1.0.0.jar",
    ): Path = TestLibs.buildJar(
        dir, fileName, mathUtilsSource,
        resources = if (json != null) mapOf("META-INF/ponder/ponder.json" to json) else emptyMap(),
        pom = pom,
    )

    // same name, local vs library

    fun testA_localFunctionNamedClampIsNeverMatchedButLibraryCallIs() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar())
        val source = """
            import com.example.math.MathUtils;
            class Example {
                int clamp(int value, int min, int max) { return value; }
                void test() {
                    CALL_LOCAL;
                    CALL_LIB;
                }
            }
        """.trimIndent()

        val local = outcomeAt("Example.java", source.replace("CALL_LOCAL", "<caret>clamp(5, 0, 10)").replace("CALL_LIB", "MathUtils.clamp(5, 0, 10)"))
        assertEquals(Reason.NO_METADATA, local.notFound().reason) // resolves to project source, which has no metadata

        val lib = outcomeAt("Example.java", source.replace("CALL_LOCAL", "clamp(5, 0, 10)").replace("CALL_LIB", "MathUtils.<caret>clamp(5, 0, 10)"))
        val match = lib.found()
        assertEquals("clamp-int", match.animation.id)
        assertEquals(CLAMP_INT, match.symbol.signature)
        assertEquals("com.example.math.MathUtils", match.symbol.declaringClass)
        assertTrue(match.symbol.provenance is Provenance.Library)
    }

    fun testA_localMethodWithItsOwnModuleAnimationAndLibraryMethodEachGetTheirOwn() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar())
        // project metadata documents the local method; it must not be used for the library call, and the other way round
        myFixture.addFileToProject(
            "META-INF/ponder/ponder.json",
            ponderJson("mine", "app", Triple("local-clamp", "Example#clamp(int,int,int)", "local clamp")),
        )
        val source = """
            import com.example.math.MathUtils;
            class Example {
                static int clamp(int value, int min, int max) { return value; }
                void test() { LOCAL; LIB; }
            }
        """.trimIndent()
        val local = outcomeAt("Example.java", source.replace("LOCAL", "<caret>clamp(5, 0, 10)").replace("LIB", "MathUtils.clamp(1,2,3)")).found()
        assertEquals("local-clamp", local.animation.id)
        assertTrue(local.symbol.provenance is Provenance.ProjectModule)

        val lib = outcomeAt("Example.java", source.replace("LOCAL", "clamp(5, 0, 10)").replace("LIB", "MathUtils.<caret>clamp(1,2,3)")).found()
        assertEquals("clamp-int", lib.animation.id)
        assertTrue(lib.symbol.provenance is Provenance.Library)
    }

    fun testA_callsOnlySharingTheNameWithAnUnrelatedJdkMethodDoNothing() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar())
        val outcome = outcomeAt("Example.java", "class Example { int t() { return Math.<caret>abs(-3); } }")
        assertEquals(Reason.NOT_APPLICABLE, outcome.notFound().reason)
    }

    fun testA_unresolvedOrErroneousCallsNeverBindToAGuess() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar())
        // wrong argument types for every overload: must not pick clamp(int,int,int) by name
        val bad = outcomeAt("Example.java", """
            import com.example.math.MathUtils;
            class Example { void t() { MathUtils.<caret>clamp("x", new Object(), null); } }
        """.trimIndent())
        bad.notFound()
        // a name that resolves nowhere
        outcomeAt("Example2.java", "class Example2 { void t() { <caret>clamp(1, 2, 3); } }").notFound()
        // not on an identifier at all
        outcomeAt("Example3.java", "class Example3 { int x = <caret>5; }").notFound()
    }

    // identical names in two libraries

    fun testB_twoLibrariesExportingIdenticalNamesResolveToTheirOwnAnimation() {
        val alpha = TestLibs.buildJar(
            TestLibs.tempDir("alpha"), "alpha-1.0.jar",
            mapOf("com/alpha/Util.java" to "package com.alpha; public class Util { public static int clamp(int v, int a, int b) { return v; } }"),
            mapOf("META-INF/ponder/ponder.json" to ponderJson("com.alpha", "alpha", Triple("alpha-clamp", "com.alpha.Util#clamp(int,int,int)", "ALPHA"))),
            Triple("com.alpha", "alpha", "1.0"),
        )
        val beta = TestLibs.buildJar(
            TestLibs.tempDir("beta"), "beta-1.0.jar",
            mapOf("com/beta/Util.java" to "package com.beta; public class Util { public static int clamp(int v, int a, int b) { return v; } }"),
            mapOf("META-INF/ponder/ponder.json" to ponderJson("com.beta", "beta", Triple("beta-clamp", "com.beta.Util#clamp(int,int,int)", "BETA"))),
            Triple("com.beta", "beta", "1.0"),
        )
        addLibrary("Gradle: com.alpha:alpha:1.0", alpha)
        addLibrary("Gradle: com.beta:beta:1.0", beta)
        val src = "class T { void t() { com.alpha.Util.A; com.beta.Util.B; } }"
        val a = outcomeAt("T.java", src.replace("A;", "<caret>clamp(1,2,3);").replace("B;", "clamp(1,2,3);")).found()
        val b = outcomeAt("T2.java", src.replace("A;", "clamp(1,2,3);").replace("B;", "<caret>clamp(1,2,3);").replace("class T ", "class T2 ")).found()
        assertEquals("ALPHA", a.animation.title)
        assertEquals("BETA", b.animation.title)
    }

    fun testB_sameFullyQualifiedClassInTwoLibrariesUsesTheLibraryTheDeclarationCameFrom() {
        fun lib(title: String, group: String) = TestLibs.buildJar(
            TestLibs.tempDir(group), "$group.jar",
            mapOf("com/shared/Util.java" to "package com.shared; public class Util { public static int clamp(int v, int a, int b) { return v; } }"),
            mapOf("META-INF/ponder/ponder.json" to ponderJson(group, group, Triple("c", "com.shared.Util#clamp(int,int,int)", title))),
            Triple(group, group, "1"),
        )
        addLibrary("Gradle: first:first:1", lib("FIRST", "first"))
        addLibrary("Gradle: second:second:1", lib("SECOND", "second"))
        // classpath conflict: the IDE binds the call to ONE of the two declarations; the animation must be that library's own
        val match = outcomeAt("T.java", "class T { void t() { com.shared.Util.<caret>clamp(1,2,3); } }").found()
        val rootUrl = (match.symbol.provenance as Provenance.Library).rootUrl
        assertEquals(if ("first" in rootUrl) "FIRST" else "SECOND", match.animation.title)
    }

    // overloads

    fun testC_overloadsAreMatchedByExactSignature() {
        val json = ponderJson(
            "com.example", "math-utils",
            Triple("int", CLAMP_INT, "INT version"),
            Triple("double", "com.example.math.MathUtils#clamp(double,double,double)", "DOUBLE version"),
        )
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = json))
        fun at(call: String) = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>$call; } }")

        assertEquals("INT version", at("clamp(1, 2, 3)").found().animation.title)
        assertEquals("DOUBLE version", at("clamp(1.0, 2.0, 3.0)").found().animation.title)
        // long overload exists in the library but has no animation: must not fall back to the int or double one
        val long = at("clamp(1L, 2L, 3L)").notFound()
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED, long.reason)
        // isBetween has no animation either
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED, at("isBetween(1, 2, 3)").notFound().reason)
    }

    fun testC_erasedGenericsVarargsArraysConstructorsAndNestedClasses() {
        val lib = TestLibs.buildJar(
            TestLibs.tempDir("shapes"), "shapes-1.0.jar",
            mapOf(
                "org/shapes/Tools.java" to """
                    package org.shapes;
                    import java.util.List;
                    public class Tools {
                        public Tools(String name) {}
                        public static <T extends Comparable<T>> T max(T a, T b) { return a; }
                        public static String join(String sep, String... parts) { return sep; }
                        public static int sum(int[] values) { return 0; }
                        public static void each(List<String> items) {}
                        public static class Inner { public static void go(long n) {} }
                    }
                """.trimIndent(),
            ),
            mapOf("META-INF/ponder/ponder.json" to ponderJson(
                "org.shapes", "shapes",
                Triple("max", "org.shapes.Tools#max(java.lang.Comparable,java.lang.Comparable)", "generic"),
                Triple("join", "org.shapes.Tools#join(java.lang.String,java.lang.String[])", "varargs"),
                Triple("sum", "org.shapes.Tools#sum(int[])", "array"),
                Triple("each", "org.shapes.Tools#each(java.util.List)", "erased list"),
                Triple("ctor", "org.shapes.Tools#<init>(java.lang.String)", "constructor"),
                Triple("inner", "org.shapes.Tools.Inner#go(long)", "nested"),
            )),
            Triple("org.shapes", "shapes", "1.0"),
        )
        addLibrary("Gradle: org.shapes:shapes:1.0", lib)
        fun at(code: String) = outcomeAt("T.java", "import org.shapes.Tools; import java.util.List; class T { void t() { $code } }")
        assertEquals("generic", at("Tools.<caret>max(\"a\", \"b\");").found().animation.title)
        assertEquals("varargs", at("Tools.<caret>join(\",\", \"a\", \"b\");").found().animation.title)
        assertEquals("array", at("Tools.<caret>sum(new int[0]);").found().animation.title)
        assertEquals("erased list", at("Tools.<caret>each((List<String>) null);").found().animation.title)
        assertEquals("nested", at("Tools.Inner.<caret>go(1L);").found().animation.title)
        assertEquals("constructor", at("new <caret>Tools(\"x\");").found().animation.title)
    }

    fun testC_inheritedMethodsReportTheirDeclaringClassNotTheUseSiteType() {
        val lib = TestLibs.buildJar(
            TestLibs.tempDir("inherit"), "inherit-1.0.jar",
            mapOf(
                "p/Base.java" to "package p; public class Base { public int clamp(int v, int a, int b) { return v; } }",
                "p/Derived.java" to "package p; public class Derived extends Base { }",
            ),
            mapOf("META-INF/ponder/ponder.json" to ponderJson("p", "inherit", Triple("base-clamp", "p.Base#clamp(int,int,int)", "BASE"))),
            Triple("p", "inherit", "1.0"),
        )
        addLibrary("Gradle: p:inherit:1.0", lib)
        // called through the subclass: still p.Base#clamp
        assertEquals("BASE", outcomeAt("T.java", "class T { void t() { new p.Derived().<caret>clamp(1,2,3); } }").found().animation.title)
        // a local subclass that overrides it: the call binds to the local override -> not the library's animation
        val overridden = outcomeAt("U.java", "class U extends p.Base { @Override public int clamp(int v, int a, int b) { return 0; } void t() { <caret>clamp(1,2,3); } }")
        overridden.notFound()
    }

    // no metadata

    fun testD_libraryWithoutPonderJsonShowsNothing() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = null))
        val outcome = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }")
        assertEquals(Reason.NO_METADATA, outcome.notFound().reason)
        assertTrue("absence of metadata is normal and must not be reported as a problem", diagnostics.isEmpty())
    }

    // invalid metadata

    /** One fixture per hostile input (a fresh library each time). */
    private fun assertInvalidMetadata(json: String) {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = json))
        val outcome = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }")
        assertEquals(Reason.INVALID_METADATA, outcome.notFound().reason)
        val errors = diagnostics.filter { it.severity == Severity.ERROR }
        assertTrue("must record a diagnostic", errors.isNotEmpty())
        assertTrue(errors.first().source, errors.first().source.endsWith("META-INF/ponder/ponder.json"))
    }

    fun testE_notJson() = assertInvalidMetadata("{ not json")
    fun testE_missingVersion() = assertInvalidMetadata("""{ "library": {"group":"g","name":"n"}, "animations": {} }""")
    fun testE_badSymbolAndEmptyAnimation() = assertInvalidMetadata(
        """{ "version": 1, "library": {"group":"com.example","name":"math-utils"}, "animations": { "x": { "symbol": "clamp", "title": "t", "actors": {}, "slides": [] } } }""")
    fun testE_wrongRootType() = assertInvalidMetadata("[]")
    fun testE_jsonNull() = assertInvalidMetadata("null")
    fun testE_binaryGarbage() = assertInvalidMetadata("\u0000garbage")
    fun testE_hostileNesting() = assertInvalidMetadata("[".repeat(100_000))

    fun testE_oversizedMetadataIsRejectedWithoutBeingLoaded() {
        val huge = " ".repeat(300 * 1024) + ponderJson("com.example", "math-utils", Triple("clamp-int", CLAMP_INT, "t"))
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = huge))
        val outcome = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }")
        assertEquals(Reason.INVALID_METADATA, outcome.notFound().reason)
        assertTrue(diagnostics.any { it.message.contains("too large") })
    }

    fun testE_oneBadAnimationInvalidatesTheFileButReportsEveryProblemWithAPath() {
        val json = """{ "version": 1, "library": {"group":"com.example","name":"math-utils"}, "animations": {
            "ok": { "symbol": "$CLAMP_INT", "title": "t", "actors": { "d": { "type": "circle" } }, "slides": [ { "id": "a" } ] },
            "bad": { "symbol": "x.Y#z(int)", "title": "t", "actors": { "d": { "type": "cirle", "radius": "big" } }, "slides": [ { "id": "a", "changes": { "ghost": { "x": 1 } } } ] }
        } }"""
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = json))
        assertEquals(Reason.INVALID_METADATA, outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }").notFound().reason)
        val messages = diagnostics.map { it.message }
        assertTrue(messages.toString(), messages.any { it.contains("animations.bad.actors.d.type") && it.contains("Did you mean \"circle\"") })
        assertTrue(messages.any { it.contains("animations.bad.slides[0].changes.ghost") })
    }

    // upgrade / removal / cache invalidation

    fun testF_libraryUpgradeInvalidatesCachedMapping() {
        val dir = TestLibs.tempDir("upgrade")
        val jar = mathUtilsJar(dir, ponderJson("com.example", "math-utils", Triple("clamp-int", CLAMP_INT, "VERSION ONE")))
        addLibrary("Gradle: com.example:math-utils:1.0.0", jar)
        val code = "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }"

        assertEquals("VERSION ONE", outcomeAt("T.java", code).found().animation.title)
        assertEquals("cached after first lookup", 1, project.service<PonderRegistry>().cacheSize)

        // "upgrade": the jar on disk is replaced by a build with different metadata (same path, new content)
        Thread.sleep(1100) // distinct timestamp even on coarse filesystems
        mathUtilsJar(dir, ponderJson("com.example", "math-utils", Triple("clamp-int-v2", CLAMP_INT, "VERSION TWO")))
        refresh(jar)
        assertEquals("VERSION TWO", outcomeAtCaret().found().animation.title)

        // a later upgrade drops the animation for this signature entirely
        Thread.sleep(1100)
        mathUtilsJar(dir, ponderJson("com.example", "math-utils", Triple("other", "com.example.math.MathUtils#isBetween(int,int,int)", "other")))
        refresh(jar)
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED, outcomeAtCaret().notFound().reason)
    }

    fun testF_removingTheLibraryInvalidatesTheCacheAndStopsMatching() {
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar())
        val code = "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }"
        outcomeAt("T.java", code).found()
        val registry = project.service<PonderRegistry>()
        assertEquals(1, registry.cacheSize)

        ModuleRootModificationUtil.updateModel(module) { m ->
            m.orderEntries.filterIsInstance<com.intellij.openapi.roots.LibraryOrderEntry>().forEach { m.removeOrderEntry(it) }
        }
        assertEquals("module-root change must drop cached documents", 0, registry.cacheSize)
        // the reference no longer resolves, so there is nothing to match
        myFixture.configureByText("T2.java", code.replace("class T", "class T2"))
        outcomeAtCaret().notFound()
    }

    fun testF_twoVersionsOfTheSameLibraryEachUseTheirOwnMetadata() {
        // the project (module A) uses v1; another jar of the same library but v2 is only visible in this fixture afterwards
        val v1 = mathUtilsJar(TestLibs.tempDir("v1"), ponderJson("com.example", "math-utils", Triple("clamp-int", CLAMP_INT, "V1")), pom = Triple("com.example", "math-utils", "1.0.0"))
        addLibrary("Gradle: com.example:math-utils:1.0.0", v1)
        val code = "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }"
        val first = outcomeAt("T.java", code).found()
        assertEquals("V1", first.animation.title)

        ModuleRootModificationUtil.updateModel(module) { m -> m.orderEntries.filterIsInstance<com.intellij.openapi.roots.LibraryOrderEntry>().forEach { m.removeOrderEntry(it) } }
        val v2 = mathUtilsJar(TestLibs.tempDir("v2"), ponderJson("com.example", "math-utils", Triple("clamp-int", CLAMP_INT, "V2")), pom = Triple("com.example", "math-utils", "2.0.0"), fileName = "math-utils-2.0.0.jar")
        addLibrary("Gradle: com.example:math-utils:2.0.0", v2)
        myFixture.configureByText("T3.java", code.replace("class T", "class T3"))
        assertEquals("V2", outcomeAtCaret().found().animation.title)
    }

    // library identity verification

    fun testLibraryDeclarationMustMatchTheResolvedLibraryWhenCoordinatesAreKnown() {
        // metadata inside a jar that (per its pom.properties) is com.example:math-utils but claims to be com.other:thing
        val lying = ponderJson("com.other", "thing", Triple("clamp-int", CLAMP_INT, "WRONG LIBRARY"))
        addLibrary("Gradle: com.example:math-utils:1.0.0", mathUtilsJar(json = lying))
        val outcome = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }").notFound()
        assertEquals(Reason.LIBRARY_MISMATCH, outcome.reason)
        assertTrue(diagnostics.any { it.severity == Severity.WARNING && it.message.contains("com.other:thing") })
    }

    fun testLibraryNameIsUsedAsEvidenceWhenThereIsNoPomProperties() {
        val jar = mathUtilsJar(pom = null, json = ponderJson("com.other", "thing", Triple("clamp-int", CLAMP_INT, "WRONG")))
        addLibrary("Gradle: com.example:math-utils:1.0.0", jar)
        assertEquals(Reason.LIBRARY_MISMATCH, outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }").notFound().reason)
    }

    fun testFileNameOfTheJarIsNeverAuthoritative() {
        // jar is named like another library, but its embedded pom.properties says what it really is
        val jar = mathUtilsJar(fileName = "totally-different-name-9.9.jar")
        addLibrary("Gradle: com.example:math-utils:1.0.0", jar)
        val m = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }").found()
        assertEquals(LibraryVerdict.Verified(dev.ponder.discovery.LibraryEvidence.Source.POM_PROPERTIES), m.verdict)
    }

    fun testUnknownCoordinatesAreAcceptedBecauseMetadataSitsInsideTheDeclaringRoot() {
        // no pom.properties, library entry has an opaque name -> cannot disprove the claim
        addLibrary("some-opaque-library-name", mathUtilsJar(pom = null))
        val m = outcomeAt("T.java", "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }").found()
        assertEquals(LibraryVerdict.Unverifiable, m.verdict)
    }

    // the real demo end to end

    fun testDemoConsumerProjectAgainstTheRealPackagedJar() {
        val repo = System.getProperty("ponder.repoRoot")?.let { java.io.File(it) } ?: error("ponder.repoRoot not set")
        val demoJar = java.io.File(repo, "examples/consumer/libs/math-utils-1.0.0.jar")
        assertTrue("demo jar missing: run  gradlew :examples:math-utils:syncDemoJar", demoJar.isFile)
        val main = java.io.File(repo, "examples/consumer/src/main/java/demo/Main.java").readText()

        addLibrary("Gradle: math-utils-1.0.0.jar", TestLibs.copyFile(demoJar, TestLibs.tempDir("demo")))

        fun at(marker: String): dev.ponder.matching.MatchOutcome {
            val idx = main.indexOf(marker).also { assertTrue("marker not found: $marker", it >= 0) }
            val callee = idx + marker.indexOf("clamp").let { if (it >= 0) it else marker.indexOf("abs") }
            val text = main.substring(0, callee) + "<caret>" + main.substring(callee)
            return outcomeAt("Main.java", text)
        }

        val library = at("MathUtils.clamp(-4, 0, 10)").found()
        assertEquals("clamp-int", library.animation.id)
        assertEquals("How clamp() works", library.animation.title)
        assertEquals(LibraryVerdict.Verified(dev.ponder.discovery.LibraryEvidence.Source.POM_PROPERTIES), library.verdict)

        assertEquals(Reason.NO_METADATA, at("int fromLocal = clamp(-4, 0, 10)").notFound().reason) // the local clamp
        assertEquals(Reason.SYMBOL_NOT_DOCUMENTED, at("MathUtils.clamp(1.5, 0.0, 1.0)").notFound().reason) // other overload
        assertEquals(Reason.NOT_APPLICABLE, at("Math.abs(-3)").notFound().reason) // unrelated JDK method
    }

    // helpers

    private fun refresh(jar: Path) {
        val vf = LocalFileSystem.getInstance().refreshAndFindFileByNioFile(jar) ?: error("jar vanished: $jar")
        runWriteAction { VfsUtil.markDirtyAndRefresh(false, false, false, vf) }
        com.intellij.openapi.vfs.JarFileSystem.getInstance().refresh(false)
    }

}
