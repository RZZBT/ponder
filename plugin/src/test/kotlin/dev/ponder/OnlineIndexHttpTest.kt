package dev.ponder

import com.intellij.openapi.application.ApplicationManager
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.sun.net.httpserver.HttpServer
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.sources.IndexProtocol
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey
import dev.ponder.sources.findAnimation
import dev.ponder.testing.TestLibs
import java.net.InetSocketAddress
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit

/** The real transport (the IDE's HttpRequests) against a local HTTP server. */
class OnlineIndexHttpTest : BasePlatformTestCase() {
    private lateinit var server: HttpServer
    private lateinit var base: String
    private val routes = HashMap<String, Pair<Int, ByteArray>>()

    override fun setUp() {
        super.setUp()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val (status, body) = routes[ex.requestURI.path] ?: (404 to "not found".toByteArray())
            if (status in 300..399) ex.responseHeaders.add("Location", String(body))
            ex.sendResponseHeaders(status, if (status in 300..399) -1 else body.size.toLong())
            if (status !in 300..399) ex.responseBody.use { it.write(body) } else ex.close()
        }
        server.start()
        base = "http://127.0.0.1:${server.address.port}/"
    }

    override fun tearDown() {
        try { server.stop(0) } finally { super.tearDown() }
    }

    private fun key(name: String) = PackageKey("npm", name, "4.17.21", LibraryEvidence.Source.PACKAGE_MANIFEST)

    private fun body(name: String) = """{ "ponderIndex": 1, "ecosystem": "npm", "name": "$name", "documents": [ { "ponder":
        { "version": 1, "library": { "name": "$name" }, "animations": { "chunk": { "symbol": "js:$name#chunk", "title": "How chunk() works",
          "actors": { "d": { "type": "circle" } }, "slides": [ { "caption": "x" } ] } } } } ] }"""

    private fun fetch(k: PackageKey): OnlineIndex.Lookup {
        val index = OnlineIndex().also { it.cacheDir = TestLibs.tempDir("ponder-http-cache") }
        return ApplicationManager.getApplication().executeOnPooledThread(Callable { index.fetch(base, k) }).get(30, TimeUnit.SECONDS)
    }

    fun testFound() {
        routes["/v1/npm/lodash.json"] = 200 to body("lodash").toByteArray()
        val l = fetch(key("lodash"))
        assertEquals("How chunk() works", l.findAnimation(key("lodash"), listOf("js:lodash#chunk"))?.animation?.title)
    }

    fun testNotInIndex() {
        assertTrue(fetch(key("left-pad")) is OnlineIndex.Lookup.Absent)
    }

    fun testServerError() {
        routes["/v1/npm/lodash.json"] = 500 to "oops".toByteArray()
        val l = fetch(key("lodash")) as OnlineIndex.Lookup.Failed
        assertEquals("the index answered with error 500", l.reason)
    }

    fun testOversizedResponseIsCutOff() {
        routes["/v1/npm/lodash.json"] = 200 to ByteArray(IndexProtocol.MAX_INDEX_BYTES + 10) { ' '.code.toByte() }
        val l = fetch(key("lodash")) as OnlineIndex.Lookup.Failed
        assertEquals("the index file is too large", l.reason)
    }

    fun testRedirectToAnotherHostCannotServeAnotherPackage() {
        // whatever a redirect leads to, the content must still be the index of the requested package
        routes["/v1/npm/lodash.json"] = 302 to "/v1/npm/evil.json".toByteArray()
        routes["/v1/npm/evil.json"] = 200 to body("evil").toByteArray()
        val l = fetch(key("lodash"))
        assertNull(l.findAnimation(key("lodash"), listOf("js:lodash#chunk", "js:evil#chunk")))
    }
}
