package dev.ponder.format

/** Limits for ponder.json. Same values as engine/src/parser/limits.ts. */
object PonderLimits {
    const val MAX_FILE_BYTES = 256 * 1024
    const val MAX_NESTING_DEPTH = 32
    const val MAX_ANIMATIONS = 64
    const val MAX_ACTORS = 200
    const val MAX_SLIDES = 60
    const val MAX_TRANSITIONS = 60
    const val MAX_ALIASES = 16
    const val MAX_ID_LENGTH = 64
    const val MAX_TEXT_LENGTH = 500
    const val MAX_CAPTION_LENGTH = 400
    const val MAX_TITLE_LENGTH = 120
    const val MAX_DESCRIPTION_LENGTH = 500
    const val MAX_SYMBOL_LENGTH = 512
    const val MAX_POLYGON_POINTS = 64
    const val MAX_GROUP_DEPTH = 8
    const val MAX_DURATION_MS = 10_000.0
    const val MAX_DELAY_MS = 10_000.0
    const val MAX_STAGGER_MS = 2_000.0
    const val MAX_TOTAL_MS = 120_000.0
    const val MAX_COORDINATE = 100_000.0
    const val MIN_SCENE_SIZE = 100
    const val MAX_SCENE_SIZE = 4_000
}

/** A problem found while validating a document. [path] is JSON-path-like, e.g. `$.animations.clamp.slides[1]`. */
data class Issue(val path: String, val message: String) {
    override fun toString() = "$path: $message"
}

/** Library coordinates a ponder.json claims to belong to. */
data class LibraryDecl(val group: String?, val name: String, val version: String?)

/** The parts of an animation the IDE uses. The engine interprets the rest. */
data class AnimationInfo(
    val id: String,
    val symbol: String,
    val aliases: List<String>,
    val title: String,
    val description: String,
    /** Slide captions, for the fallback view. */
    val captions: List<String> = emptyList(),
) {
    val allSymbols: List<String> get() = listOf(symbol) + aliases
}

/** [text] is the source that passed validation; the renderer gets exactly this. */
class PonderDocument(
    val library: LibraryDecl,
    val animations: List<AnimationInfo>,
    val text: String,
) {
    private val bySymbol: Map<String, AnimationInfo> = buildMap {
        for (a in animations) for (s in a.allSymbols) put(PonderSymbols.normalize(s), a)
        // `cpp:ns::f` also finds `cpp:ns::f(int)` when that is the only overload with an animation
        animations.flatMap { a -> a.allSymbols.filter { it.startsWith("cpp:") && it.endsWith(")") }.map { it.substringBefore('(') to a } }
            .groupBy({ it.first }, { it.second }).forEach { (k, v) -> if (v.size == 1 && k !in this) put(k, v.single()) }
    }

    fun find(symbol: String): AnimationInfo? = bySymbol[PonderSymbols.normalize(symbol)]

    /** First animation bound to any of [symbols]. */
    fun findAny(symbols: Collection<String>): AnimationInfo? = symbols.firstNotNullOfOrNull { find(it) }
}

class ValidationReport(
    val errors: List<Issue>,
    val warnings: List<Issue>,
    val document: PonderDocument?,
) {
    val ok: Boolean get() = errors.isEmpty() && document != null
}
