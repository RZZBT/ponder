package dev.ponder

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import dev.ponder.matching.MatchOutcome.Reason
import dev.ponder.matching.Origin
import dev.ponder.settings.PonderSettings
import dev.ponder.sources.LocalFolders
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKeys
import dev.ponder.testing.PonderTestBase
import dev.ponder.testing.TestLibs
import dev.ponder.testing.TestLibs.ponderJson
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit

/** Library file, local folders and the online index together, through the real resolution pipeline. */
class ExternalSourcesTest : PonderTestBase() {
    private val clampSymbol = "com.example.math.MathUtils#clamp(int,int,int)"
    private val call = "import com.example.math.MathUtils; class T { void t() { MathUtils.<caret>clamp(1,2,3); } }"
    private val source = mapOf(
        "com/example/math/MathUtils.java" to
            "package com.example.math; public final class MathUtils { public static int clamp(int v, int a, int b) { return v; } }",
    )
    private lateinit var saved: Triple<String?, String?, String?>
    private lateinit var index: OnlineIndex
    private val served = HashMap<String, String>()

    override fun setUp() {
        super.setUp()
        val s = service<PonderSettings>().state
        saved = Triple(s.onlineLookup, s.indexUrl, s.localFolders)
        s.onlineLookup = PonderSettings.ONLINE_ON
        s.indexUrl = "https://index.test/"
        s.localFolders = ""
        index = service<OnlineIndex>()
        index.cacheDir = TestLibs.tempDir("ponder-ext-cache")
        index.clearCache()
        index.fetcher = OnlineIndex.Fetcher { url, _ -> served[url] }
        service<LocalFolders>().clearCache()
    }

    override fun tearDown() {
        try {
            val s = service<PonderSettings>().state
            s.onlineLookup = saved.first; s.indexUrl = saved.second; s.localFolders = saved.third
            service<OnlineIndex>().clearCache()
        } finally {
            super.tearDown()
        }
    }

    private fun jar(json: String? = null, pom: Triple<String, String, String>? = Triple("com.example", "math-utils", "1.2.0"), name: String = "math-utils.jar"): Path =
        TestLibs.buildJar(TestLibs.tempDir("ext-lib"), name, source,
            if (json != null) mapOf("META-INF/ponder/ponder.json" to json) else emptyMap(), pom)

    private fun serveMaven(title: String, versions: String? = null) {
        val doc = ponderJson("com.example", "math-utils", Triple("clamp", clampSymbol, title))
        served["https://index.test/v1/maven/com.example/math-utils.json"] =
            """{ "ponderIndex": 1, "ecosystem": "maven", "name": "com.example:math-utils", "documents": [ { ${versions?.let { "\"versions\": \"$it\", " } ?: ""}"ponder": $doc } ] }"""
    }

    /** What Alt+W does after the read action: fetch in the background, then match the fetched index. */
    private fun fetchThenMatch(): String? {
        val nf = outcomeAt("T.java", call).notFound()
        val key = nf.packageKey ?: return null
        val lookup = ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch("https://index.test/", key) }).get(20, TimeUnit.SECONDS)
        return project.service<dev.ponder.matching.PonderService>().evaluateFetched(nf.symbol!!, key, lookup)?.match?.animation?.title
    }

    fun testLibraryWithoutAnimationGetsTheOnlineOne() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        serveMaven("FROM THE INDEX")
        val nf = outcomeAt("T.java", call).notFound()
        assertEquals(Reason.NO_METADATA, nf.reason)
        assertEquals("maven", nf.packageKey?.ecosystem)
        assertEquals("com.example:math-utils", nf.packageKey?.name)
        assertEquals("1.2.0", nf.packageKey?.version)
        assertEquals("FROM THE INDEX", fetchThenMatch())
        // afterwards the cache answers inside the read action too (gutter icon, next Alt+W), with its origin shown
        val m = outcomeAtCaret().found()
        assertEquals(Origin.ONLINE_INDEX, m.origin)
        assertEquals("Community index · maven/com.example:math-utils", m.sourceLabel)
    }

    fun testTheLibrarysOwnAnimationAlwaysWins() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar(ponderJson("com.example", "math-utils", Triple("clamp", clampSymbol, "FROM THE LIBRARY"))))
        serveMaven("FROM THE INDEX")
        val m = outcomeAt("T.java", call).found()
        assertEquals("FROM THE LIBRARY", m.animation.title)
        assertEquals(Origin.LIBRARY, m.origin)
        assertEquals("From the library", m.sourceLabel)
    }

    fun testOnlineAnimationOutsideTheVersionRangeIsNotUsed() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        serveMaven("OLD API", versions = "<1.0")
        assertNull(fetchThenMatch())
    }

    fun testOnlineLookupOffMeansNoNetworkAndNoCache() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        serveMaven("FROM THE INDEX")
        assertEquals("FROM THE INDEX", fetchThenMatch()) // now cached
        service<PonderSettings>().state.onlineLookup = PonderSettings.ONLINE_OFF
        assertEquals(Reason.NO_METADATA, outcomeAtCaret().notFound().reason)
    }

    fun testFatJarWithSeveralPomsIsNeverGuessed() {
        val j = TestLibs.buildJar(TestLibs.tempDir("fat"), "fat.jar", source, mapOf(
            "META-INF/maven/a/one/pom.properties" to "groupId=a\nartifactId=one\nversion=1\n",
            "META-INF/maven/b/two/pom.properties" to "groupId=b\nartifactId=two\nversion=1\n",
        ))
        addLibrary("fat", j)
        assertNull(outcomeAt("T.java", call).notFound().packageKey)
    }

    fun testOwnProjectCodeNeverGetsExternalAnimations() {
        val folder = TestLibs.tempDir("ponder-local")
        Files.writeString(folder.resolve("mine.json"), ponderJson("mine", "app", Triple("c", "Local#clamp(int,int,int)", "LOCAL FILE")))
        service<PonderSettings>().state.localFolders = folder.toString()
        val nf = outcomeAt("Local.java", "class Local { static int clamp(int v, int a, int b) { return v; } void t() { <caret>clamp(1,2,3); } }").notFound()
        assertNull(nf.packageKey)
    }

    fun testLocalFolderSuppliesAnAnimation() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        val folder = TestLibs.tempDir("ponder-local")
        Files.writeString(folder.resolve("math-utils.json"), ponderJson("com.example", "math-utils", Triple("clamp", clampSymbol, "MY OWN")))
        service<PonderSettings>().state.localFolders = "  \n${folder}\n/does/not/exist\n"
        val m = outcomeAt("T.java", call).found()
        assertEquals("MY OWN", m.animation.title)
        assertEquals(Origin.LOCAL_FOLDER, m.origin)
        assertEquals("Local file · math-utils.json", m.sourceLabel)
    }

    fun testLocalFileForAnotherLibraryIsIgnoredAndBrokenFilesAreHarmless() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        val folder = TestLibs.tempDir("ponder-local")
        Files.writeString(folder.resolve("other.json"), ponderJson("com.other", "thing", Triple("clamp", clampSymbol, "WRONG LIBRARY")))
        Files.writeString(folder.resolve("broken.json"), "{ \"animations\": oops")
        Files.writeString(folder.resolve("package.json"), "{ \"name\": \"not-a-ponder-file\" }")
        Files.write(folder.resolve("binary.json"), byteArrayOf(0, 1, 2, -1))
        service<PonderSettings>().state.localFolders = folder.toString()
        assertEquals(Reason.NO_METADATA, outcomeAt("T.java", call).notFound().reason)
    }

    fun testLocalFolderWinsOverTheOnlineIndex() {
        addLibrary("Gradle: com.example:math-utils:1.2.0", jar())
        serveMaven("FROM THE INDEX")
        assertEquals("FROM THE INDEX", fetchThenMatch())
        val folder = TestLibs.tempDir("ponder-local")
        Files.writeString(folder.resolve("m.json"), ponderJson("com.example", "math-utils", Triple("clamp", clampSymbol, "MY OWN")))
        service<PonderSettings>().state.localFolders = folder.toString()
        assertEquals("MY OWN", outcomeAtCaret().found().animation.title)
    }

    // ------------------------------------------------------------------ package identification helpers

    fun testManifestVersions() {
        assertEquals("4.17.21", PackageKeys.manifestVersion("package.json", """{ "name": "lodash", "version": "4.17.21" }"""))
        assertEquals("1.0.3", PackageKeys.manifestVersion("Cargo.toml", "[package]\nname = \"x\"\nversion = \"1.0.3\"\n[dependencies]\nversion = \"9\""))
        assertEquals("2.1", PackageKeys.manifestVersion("pyproject.toml", "[project]\nname='m'\nversion = '2.1'"))
        assertNull(PackageKeys.manifestVersion("pyproject.toml", "[project]\nname='m'\ndynamic=['version']"))
        assertEquals("v1.8.0", PackageKeys.goVersionFromDirName("mux@v1.8.0"))
        assertNull(PackageKeys.goVersionFromDirName("mux"))
        assertEquals("scikit_learn", PackageKeys.distNameFromDir("scikit_learn-1.3.0.dist-info"))
        assertEquals("scikit-learn" to "1.3.0", PackageKeys.parseDistMetadata("Metadata-Version: 2.1\nName: scikit-learn\nVersion: 1.3.0\n\nName: not-this"))
        assertNull(PackageKeys.parseDistMetadata("garbage"))
    }
}
