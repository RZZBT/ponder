package dev.ponder

import dev.ponder.bridge.BridgeMessage
import dev.ponder.bridge.BridgeMessages
import dev.ponder.bridge.PonderHtml
import dev.ponder.bridge.StartOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The trust boundary between the (untrusted-data-driven) page and the IDE. */
class BridgeTest {

    @Test
    fun acceptsOnlyTheClosedSetOfMessages() {
        assertEquals(BridgeMessage.Ready, BridgeMessages.parse("""{"type":"ready"}"""))
        assertEquals(BridgeMessage.Close, BridgeMessages.parse("""{"type":"close"}"""))
        assertEquals(BridgeMessage.ToggleExpand(true), BridgeMessages.parse("""{"type":"toggleExpand","expanded":true}"""))
        assertEquals(BridgeMessage.Error("boom"), BridgeMessages.parse("""{"type":"error","message":"boom"}"""))
    }

    @Test
    fun rejectsEverythingElse() {
        listOf(
            null, "", "not json", "[]", "5", "null", """{"type":"exec","cmd":"calc"}""", """{"type":"openFile","path":"/etc/passwd"}""",
            """{"type":"toggleExpand"}""", """{"type":"toggleExpand","expanded":"yes"}""", """{"type":5}""", """{"type":"error"}""",
            """{"type":"error","message":5}""", "{".repeat(100), """{"type":"ready"}""" + " ".repeat(BridgeMessages.MAX_RAW_LENGTH),
        ).forEach { assertNull("should be dropped: $it", BridgeMessages.parse(it)) }
    }

    @Test
    fun sanitizesPageControlledText() {
        val m = BridgeMessages.parse("""{"type":"error","message":"a\u0000b\nc${"x".repeat(1000)}"}""") as BridgeMessage.Error
        assertFalse(m.message.any { it.isISOControl() })
        assertTrue(m.message.length <= BridgeMessages.MAX_ERROR_LENGTH)
    }

    @Test
    fun pageHasStrictCspAndNeverContainsLibraryData() {
        val nonce = PonderHtml.newNonce()
        val html = PonderHtml.page(nonce, "#1b1e27")
        assertTrue(html.contains("default-src 'none'"))
        assertTrue(html.contains("connect-src 'none'"))
        assertTrue(html.contains("frame-src 'none'"))
        assertTrue(html.contains("script-src 'nonce-$nonce'"))
        assertFalse("no remote loads", Regex("""(src|href)=["']https?:""").containsMatchIn(html))
        assertTrue(html.contains("""<div id="ponder-root">"""))
    }

    @Test
    fun rejectsUnsafeNonceAndBackground() {
        listOf("a b", "a\"b", "<x>").forEach { n -> try { PonderHtml.page(n, "#000"); error("accepted $n") } catch (e: IllegalArgumentException) { } }
        try { PonderHtml.page("abc", "red;}</style><script>"); error("accepted") } catch (e: IllegalArgumentException) { }
    }

    @Test
    fun startScriptEmbedsDocumentOnlyAsAnEscapedStringLiteral() {
        val evil = "\"); alert(1); (\"</script><img src=x onerror=1>\u2028\n"
        val js = PonderHtml.startScript(evil, "id\"x", StartOptions(true, true, null, mapOf("background" to "#112233", "accent" to "url(javascript:1)", "bogus" to "#fff")))
        assertFalse("raw </script must not appear", js.contains("</script"))
        assertFalse(js.contains("\u2028"))
        assertFalse("newline must be escaped", js.lines().size > 1)
        assertTrue(js.startsWith("Ponder.start(\""))
        assertTrue("valid color kept", js.contains("#112233"))
        assertFalse("non-hex color dropped", js.contains("javascript:"))
        assertFalse("unknown color key dropped", js.contains("bogus"))
    }
}
