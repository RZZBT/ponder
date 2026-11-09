package dev.ponder.bridge

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonPrimitive

/** Messages the embedded page may send to the IDE. Anything else is dropped. */
sealed interface BridgeMessage {
    data object Ready : BridgeMessage
    data object Close : BridgeMessage
    data class ToggleExpand(val expanded: Boolean) : BridgeMessage
    data class Error(val message: String) : BridgeMessage
}

/** Parses messages from the page. The page renders untrusted data, so anything unknown or malformed is dropped. */
object BridgeMessages {
    const val MAX_RAW_LENGTH = 2_000
    const val MAX_ERROR_LENGTH = 300

    fun parse(raw: String?): BridgeMessage? {
        if (raw == null || raw.length > MAX_RAW_LENGTH) return null
        val obj = try {
            (JsonParser.parseString(raw) as? JsonObject) ?: return null
        } catch (e: Exception) {
            return null
        }
        val type = (obj.get("type") as? JsonPrimitive)?.takeIf { it.isString }?.asString ?: return null
        return when (type) {
            "ready" -> BridgeMessage.Ready
            "close" -> BridgeMessage.Close
            "toggleExpand" -> {
                val e = (obj.get("expanded") as? JsonPrimitive)?.takeIf { it.isBoolean } ?: return null
                BridgeMessage.ToggleExpand(e.asBoolean)
            }
            "error" -> {
                val m = (obj.get("message") as? JsonPrimitive)?.takeIf { it.isString }?.asString ?: return null
                BridgeMessage.Error(sanitize(m))
            }
            else -> null
        }
    }

    /** Drops control characters and truncates, so page-controlled text is safe to log and show. */
    internal fun sanitize(s: String): String =
        s.filter { it == ' ' || !it.isISOControl() }.take(MAX_ERROR_LENGTH)
}
