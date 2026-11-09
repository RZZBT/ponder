package dev.ponder.bridge

import com.google.gson.GsonBuilder
import com.google.gson.JsonObject
import java.security.SecureRandom
import java.util.Base64

/** Options sent to `Ponder.start(...)` in the page. Colors must already be `#hex` (the page ignores anything else). */
data class StartOptions(
    val dark: Boolean,
    val autoplay: Boolean,
    /** null = follow the OS / Chromium `prefers-reduced-motion`; true forces reduced motion. */
    val reducedMotion: Boolean?,
    val colors: Map<String, String>,
)

/**
 * The page that hosts the engine: the bundled engine only, under a CSP without network access. The ponder.json
 * text is never put into the HTML; it is passed to `Ponder.start(...)` as a string literal after load.
 */
object PonderHtml {
    private val gson = GsonBuilder().disableHtmlEscaping().create() // output goes into JS, not HTML

    private val js: String by lazy { resource("ponder/web/ponder-player.js") }
    private val css: String by lazy { resource("ponder/web/ponder-player.css") }

    fun newNonce(): String = ByteArray(18).also { SecureRandom().nextBytes(it) }.let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }

    fun page(nonce: String, bodyBackground: String): String {
        require(Regex("^[A-Za-z0-9_-]+$").matches(nonce)) { "unsafe nonce" }
        require(Regex("^#[0-9a-fA-F]{3,8}$").matches(bodyBackground)) { "background must be a #hex color" }
        val csp = "default-src 'none'; script-src 'nonce-$nonce'; style-src 'nonce-$nonce'; img-src data:; " +
            "connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; " +
            "base-uri 'none'; form-action 'none'"
        return """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="$csp">
<style nonce="$nonce">${css}
html,body{background:$bodyBackground !important}</style>
</head><body><div id="ponder-root"></div>
<script nonce="$nonce">${js.replace("</script", "<\\/script")}</script>
</body></html>"""
    }

    /** `Ponder.start("<document>", "<animationId>", {options});` with every value emitted as a JS-safe literal. */
    fun startScript(documentText: String, animationId: String, options: StartOptions): String {
        val opts = JsonObject().apply {
            addProperty("theme", if (options.dark) "dark" else "light")
            addProperty("autoplay", options.autoplay)
            options.reducedMotion?.let { addProperty("reducedMotion", it) }
            add("colors", JsonObject().also { c ->
                options.colors.forEach { (k, v) -> if (HEX.matches(v) && k in COLOR_KEYS) c.addProperty(k, v) }
            })
        }
        return "Ponder.start(${literal(documentText)}, ${literal(animationId)}, ${gson.toJson(opts)});"
    }

    /** A JS string literal that is also safe inside an HTML-embedded script (escapes `<`, line separators etc.). */
    internal fun literal(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\u2028' -> sb.append("\\u2028")
            c == '\u2029' -> sb.append("\\u2029")
            c == '<' -> sb.append("\\u003c")
            c.code < 0x20 -> sb.append(String.format("\\u%04x", c.code))
            else -> sb.append(c)
        }
        return sb.append('"').toString()
    }

    private val HEX = Regex("^#[0-9a-fA-F]{3,8}$")
    private val COLOR_KEYS = setOf("background", "foreground", "muted", "accent", "border")

    private fun resource(path: String): String =
        PonderHtml::class.java.classLoader.getResourceAsStream(path)?.use { it.readBytes().toString(Charsets.UTF_8) }
            ?: error("Ponder engine asset missing from the plugin: $path (run the engine build)")
}
