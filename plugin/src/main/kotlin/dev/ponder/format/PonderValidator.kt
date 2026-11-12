package dev.ponder.format

import com.google.gson.Gson
import com.google.gson.JsonArray
import com.google.gson.JsonElement
import com.google.gson.JsonNull
import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonToken
import java.io.StringReader
import kotlin.math.min

/**
 * Validates ponder.json and extracts what the IDE needs. Kotlin port of engine/src/parser/validate.ts; both run
 * the fixtures in schema/fixtures, so keep them in step. Never throws: problems become [Issue]s.
 */
object PonderValidator {

    fun validate(raw: String): ValidationReport {
        val text = raw.removePrefix("﻿") // Windows editors save UTF-8 with a byte order mark
        val bytes = text.toByteArray(Charsets.UTF_8).size
        if (bytes > PonderLimits.MAX_FILE_BYTES) {
            return failed("$", "File is too large ($bytes bytes, maximum ${PonderLimits.MAX_FILE_BYTES}).")
        }
        if (nestingDepth(text) > PonderLimits.MAX_NESTING_DEPTH) {
            return failed("$", "JSON is nested deeper than ${PonderLimits.MAX_NESTING_DEPTH} levels.")
        }
        val json = try {
            val reader = JsonReader(StringReader(text)) // strict by default
            val element = Gson().getAdapter(JsonElement::class.java).read(reader)
            if (reader.peek() != JsonToken.END_DOCUMENT) throw IllegalStateException("unexpected content after the JSON value")
            element
        } catch (e: Throwable) { // also StackOverflowError
            return failed("$", "Not valid JSON: ${e.message?.lineSequence()?.firstOrNull() ?: e.javaClass.simpleName}")
        }
        return try {
            Run(text).run(json)
        } catch (e: Throwable) {
            failed("$", "Internal validation failure: ${e.javaClass.simpleName}: ${e.message}")
        }
    }

    /** `pkg.Class#method(type,type)` */
    fun isValidSymbol(s: String): Boolean = s.length <= PonderLimits.MAX_SYMBOL_LENGTH && PonderSymbols.isValid(s)

    private const val SYMBOL_HELP =
        "Examples: \"com.example.MathUtils#clamp(int,int,int)\" (Java/Kotlin, fully qualified parameter types), " +
            "\"py:mathutils.clamp\", \"js:math-utils#clamp\", \"dotnet:M:MathUtils.Clamp(System.Int32)\", \"go:example.com/m.Clamp\", " +
            "\"rust:math_utils::clamp\", \"cpp:math::clamp(int)\", or \"sym:src/file.ext:Outer.name\" for any other language."

    private val ID_RE = Regex("^[A-Za-z0-9][A-Za-z0-9_.-]*$")
    private val HEX_RE = Regex("^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
    private val RESERVED = setOf("__proto__", "constructor", "prototype", "toString", "hasOwnProperty")
    private val COLOR_TOKENS = listOf("none", "text", "muted", "accent", "accent2", "success", "warning", "danger", "surface")
    private val ACTOR_TYPES = listOf("rectangle", "circle", "ellipse", "text", "line", "arrow", "polygon", "group")
    private val EASINGS = listOf("linear", "ease-in", "ease-out", "ease-in-out", "back-out")
    private val ANIMATION_KEYS = listOf("symbol", "aliases", "title", "description", "scene", "autoAdvance", "actors", "slides", "transitions")
    private val TIMING_KEYS = listOf("trigger", "style", "duration", "delay", "easing", "stagger", "order")
    private val SLIDE_KEYS = listOf("id", "caption", "changes") + TIMING_KEYS
    private val TRANSITION_KEYS = listOf("from", "to") + TIMING_KEYS
    /** `"//"` holds a comment and is allowed in every object. */
    private const val COMMENT_KEY = "//"
    private const val MAX_COMMENT_LENGTH = 1000
    private const val MAX_COMMENT_LINES = 50
    private const val AUTO_ADVANCE_DELAY = 1500.0 // TRANSITION_DEFAULTS.autoAdvanceDelay in the engine

    private sealed interface Spec
    private data class Num(val min: Double, val max: Double, val int: Boolean = false) : Spec
    private object Bool : Spec
    private object Color : Spec
    private data class Txt(val maxLen: Int) : Spec
    private data class Enum(val values: List<String>) : Spec
    private object Points : Spec

    private const val L = PonderLimits.MAX_COORDINATE
    private val COMMON: Map<String, Spec> = mapOf(
        "x" to Num(-L, L), "y" to Num(-L, L), "rotation" to Num(-36_000.0, 36_000.0), "scale" to Num(0.0, 100.0),
        "opacity" to Num(0.0, 1.0), "visible" to Bool, "z" to Num(-1000.0, 1000.0, int = true),
    )
    private val PAINT: Map<String, Spec> = mapOf("fill" to Color, "stroke" to Color, "strokeWidth" to Num(0.0, 100.0))
    private val PROPS: Map<String, Map<String, Spec>> = mapOf(
        "rectangle" to COMMON + PAINT + mapOf("width" to Num(0.0, L), "height" to Num(0.0, L), "cornerRadius" to Num(0.0, L)),
        "circle" to COMMON + PAINT + mapOf("radius" to Num(0.0, L)),
        "ellipse" to COMMON + PAINT + mapOf("width" to Num(0.0, L), "height" to Num(0.0, L)),
        "text" to COMMON + mapOf(
            "fill" to Color, "text" to Txt(PonderLimits.MAX_TEXT_LENGTH), "fontSize" to Num(1.0, 200.0),
            "anchor" to Enum(listOf("start", "middle", "end")),
        ),
        "line" to COMMON + mapOf("stroke" to Color, "strokeWidth" to Num(0.0, 100.0), "width" to Num(-L, L), "height" to Num(-L, L)),
        "arrow" to COMMON + mapOf("stroke" to Color, "strokeWidth" to Num(0.0, 100.0), "width" to Num(-L, L), "height" to Num(-L, L)),
        "polygon" to COMMON + PAINT + mapOf("points" to Points),
        "group" to COMMON,
    )

    /**
     * Optional features a file can declare in `"requires"`. A file that requires a feature missing here is reported
     * with one clear "update Ponder" message. Keep equal to PONDER_FEATURES in engine/src/parser/validate.ts.
     */
    val PONDER_FEATURES: Set<String> = emptySet()
    private val FEATURE_NAME = Regex("^[a-z][a-z0-9-]{0,39}$")

    /** Why [root] is meant for a newer Ponder, or null. Checked before anything else. */
    private fun newerPonderNeeded(root: JsonObject): Issue? {
        val v = num(root.get("version"))
        if (v != null && v == Math.floor(v) && v > 1 && v < 1e9) {
            return Issue("$.version", "This file uses ponder.json format version ${v.toLong()}, which is newer than this Ponder understands (version 1). Update Ponder to see this animation.")
        }
        val req = root.get("requires") as? JsonArray ?: return null
        val missing = req.mapNotNull { str(it) }.filter { it.matches(FEATURE_NAME) && it !in PONDER_FEATURES }
        if (missing.isEmpty()) return null
        return Issue("$.requires", "This file needs a newer Ponder: it uses ${missing.joinToString(", ") { "\"$it\"" }}, which this version does not have. Update Ponder to see this animation.")
    }

    private fun failed(path: String, message: String) = ValidationReport(listOf(Issue(path, message)), emptyList(), null)

    /** Bracket depth, computed without recursion so deep input cannot overflow the stack. */
    private fun nestingDepth(text: String): Int {
        var depth = 0; var max = 0; var inString = false; var escaped = false
        for (c in text) {
            if (inString) {
                if (escaped) escaped = false else if (c == '\\') escaped = true else if (c == '"') inString = false
            } else when (c) {
                '"' -> inString = true
                '{', '[' -> { depth++; if (depth > max) max = depth }
                '}', ']' -> depth--
            }
        }
        return max
    }

    private fun distance(a: String, b: String): Int {
        val dp = Array(a.length + 1) { IntArray(b.length + 1) }
        for (i in 0..a.length) dp[i][0] = i
        for (j in 0..b.length) dp[0][j] = j
        for (i in 1..a.length) for (j in 1..b.length) {
            dp[i][j] = min(min(dp[i - 1][j] + 1, dp[i][j - 1] + 1), dp[i - 1][j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        }
        return dp[a.length][b.length]
    }

    private fun suggest(word: String, options: Collection<String>): String {
        var best: String? = null; var bestD = 3
        for (o in options) {
            val d = distance(word.lowercase(), o.lowercase())
            if (d < bestD) { bestD = d; best = o }
        }
        return best?.let { " Did you mean \"$it\"?" } ?: ""
    }

    private fun describe(v: JsonElement?): String = when {
        v == null || v is JsonNull -> "null"
        v is JsonArray -> "an array"
        v is JsonObject -> "an object"
        v is JsonPrimitive && v.isString -> v.asString.let { "the string \"${if (it.length > 30) it.take(30) + "..." else it}\"" }
        v is JsonPrimitive && v.isBoolean -> "the boolean ${v.asBoolean}"
        v is JsonPrimitive -> "the number ${v.asString}"
        else -> "an unexpected value"
    }

    private fun num(v: JsonElement?): Double? =
        (v as? JsonPrimitive)?.takeIf { it.isNumber }?.asDouble

    private fun str(v: JsonElement?): String? =
        (v as? JsonPrimitive)?.takeIf { it.isString }?.asString

    private fun fmt(d: Double): String = if (d == Math.floor(d) && !d.isInfinite() && kotlin.math.abs(d) < 1e15) d.toLong().toString() else d.toString()

    private class Run(private val text: String) {
        val errors = ArrayList<Issue>()
        val warnings = ArrayList<Issue>()

        fun error(path: String, message: String) { if (errors.size < 100) errors += Issue(path, message) }

        fun run(root: JsonElement): ValidationReport {
            if (root !is JsonObject) {
                error("$", "A ponder.json file must contain a JSON object, but found ${describe(root)}.")
                return ValidationReport(errors, warnings, null)
            }
            newerPonderNeeded(root)?.let { return ValidationReport(listOf(it), emptyList(), null, needsUpdate = true) }
            checkKeys("$", root, listOf("\$schema", "version", "requires", "library", "animations"))
            root.get("requires")?.let { req ->
                if (req !is JsonArray || req.size() > 16) {
                    error("$.requires", "Expected a list of at most 16 feature names, e.g. \"requires\": [].")
                } else {
                    req.forEachIndexed { i, f ->
                        if (str(f)?.matches(FEATURE_NAME) != true) error("$.requires[$i]", "Expected a feature name (lower-case letters, digits and dashes) but found ${describe(f)}.")
                    }
                }
            }
            val version = root.get("version")
            if (version == null) error("$.version", "Required property is missing. Add \"version\": 1.")
            else if (num(version) != 1.0) error("$.version", "Unsupported format version ${describe(version)}. This Ponder understands version 1 only.")

            var library: LibraryDecl? = null
            val lib = root.get("library")
            if (lib !is JsonObject) {
                error("$.library", "Required property is missing. Add \"library\": { \"name\": \"...\" }.")
            } else {
                checkKeys("$.library", lib, listOf("group", "name", "version"))
                val g = lib.get("group")?.let { checkString("$.library.group", it, 200) }
                val n = checkString("$.library.name", lib.get("name"), 200)
                val v = lib.get("version")?.let { checkString("$.library.version", it, 100) }
                if (n != null && (g != null || lib.get("group") == null)) library = LibraryDecl(g, n, v)
            }

            val infos = ArrayList<AnimationInfo>()
            val anims = root.get("animations")
            if (anims !is JsonObject) {
                error("$.animations", if (anims == null) "Required property is missing." else "Expected an object of animations but found ${describe(anims)}.")
            } else {
                if (anims.size() == 0) error("$.animations", "The file defines no animations.")
                if (anims.size() > PonderLimits.MAX_ANIMATIONS) {
                    error("$.animations", "Too many animations (${anims.size()}, maximum ${PonderLimits.MAX_ANIMATIONS}).")
                } else {
                    val seen = HashMap<String, String>()
                    for ((id, a) in anims.entrySet()) {
                        checkId("$.animations.$id", id, "animation")
                        validateAnimation("$.animations.$id", id, a, seen)?.let { infos += it }
                    }
                }
            }
            val ok = errors.isEmpty() && library != null
            return ValidationReport(errors, warnings, if (ok) PonderDocument(library, infos, text) else null)
        }


        fun checkKeys(path: String, obj: JsonObject, allowed: List<String>) {
            for (k in obj.keySet()) {
                if (k == COMMENT_KEY) { checkComment("$path.$k", obj.get(k)); continue }
                if (k !in allowed) error("$path.$k", "Unknown property \"$k\".${suggest(k, allowed)}")
            }
        }

        fun checkComment(path: String, v: JsonElement?) {
            if (v !is JsonArray) {
                if (str(v) == null) error(path, "Expected a string (or a list of strings) but found ${describe(v)}.")
                else checkString(path, v, MAX_COMMENT_LENGTH)
                return
            }
            if (v.size() > MAX_COMMENT_LINES) { error(path, "A comment may have at most $MAX_COMMENT_LINES lines."); return }
            v.forEachIndexed { i, line -> checkString("$path[$i]", line, MAX_COMMENT_LENGTH) }
        }

        fun checkTiming(p: String, t: JsonObject, actorIds: Collection<String>) {
            t.get("trigger")?.let { v -> val s = str(v); if (s != "auto" && s != "next") error("$p.trigger", "Expected \"auto\" or \"next\" but found ${describe(v)}.${if (s != null) suggest(s, listOf("auto", "next")) else ""}") }
            t.get("style")?.let { v -> val s = str(v); if (s != "direct" && s != "fluid") error("$p.style", "Expected \"direct\" or \"fluid\" but found ${describe(v)}.${if (s != null) suggest(s, listOf("direct", "fluid")) else ""}") }
            t.get("duration")?.let { checkNumber("$p.duration", it, 0.0, PonderLimits.MAX_DURATION_MS) }
            t.get("delay")?.let { checkNumber("$p.delay", it, 0.0, PonderLimits.MAX_DELAY_MS) }
            t.get("stagger")?.let { checkNumber("$p.stagger", it, 0.0, PonderLimits.MAX_STAGGER_MS) }
            t.get("easing")?.let { checkEasing("$p.easing", it) }
            t.get("order")?.let { o ->
                if (o !is JsonArray) error("$p.order", "Expected a list of actor ids but found ${describe(o)}.")
                else o.forEachIndexed { j, e ->
                    val es = str(e)
                    if (es == null || es !in actorIds) error("$p.order[$j]", "Unknown actor ${describe(e)}.${if (es != null) suggest(es, actorIds) else ""}")
                }
            }
        }

        fun checkId(path: String, id: String, what: String): Boolean {
            if (id.length > PonderLimits.MAX_ID_LENGTH) { error(path, "$what id is longer than ${PonderLimits.MAX_ID_LENGTH} characters."); return false }
            if (!ID_RE.matches(id)) { error(path, "$what id \"$id\" may only contain letters, digits, \"_\", \"-\" and \".\" and must start with a letter or digit."); return false }
            if (id in RESERVED) { error(path, "\"$id\" is a reserved name and cannot be used as $what id."); return false }
            return true
        }

        fun checkString(path: String, v: JsonElement?, max: Int, required: Boolean = true): String? {
            if (v == null) { if (required) error(path, "Required property is missing."); return null }
            val s = str(v)
            if (s == null) { error(path, "Expected a string but found ${describe(v)}."); return null }
            if (s.length > max) { error(path, "Text is too long (${s.length} characters, maximum $max)."); return null }
            return s
        }

        fun checkNumber(path: String, v: JsonElement?, min: Double, max: Double, int: Boolean = false): Double? {
            val d = num(v)
            if (d == null) { error(path, "Expected a number but found ${describe(v)}."); return null }
            if (d.isNaN() || d.isInfinite()) { error(path, "Number must be finite."); return null }
            if (d < min || d > max) { error(path, "${fmt(d)} is out of range (allowed ${fmt(min)} to ${fmt(max)})."); return null }
            if (int && d != Math.floor(d)) { error(path, "${fmt(d)} must be a whole number."); return null }
            return d
        }

        fun isColor(v: JsonElement?): Boolean = str(v)?.let { HEX_RE.matches(it) || it in COLOR_TOKENS } ?: false

        fun checkProp(path: String, spec: Spec, v: JsonElement?) {
            when (spec) {
                is Num -> checkNumber(path, v, spec.min, spec.max, spec.int)
                Bool -> if (v !is JsonPrimitive || !v.isBoolean) error(path, "Expected true or false but found ${describe(v)}.")
                Color -> if (!isColor(v)) error(path, "Expected a color (#rgb, #rrggbb, #rrggbbaa or one of ${COLOR_TOKENS.joinToString(", ")}) but found ${describe(v)}.")
                is Txt -> checkString(path, v, spec.maxLen)
                is Enum -> {
                    val s = str(v)
                    if (s == null || s !in spec.values) error(path, "Expected one of ${spec.values.joinToString(", ") { "\"$it\"" }} but found ${describe(v)}.${if (s != null) suggest(s, spec.values) else ""}")
                }
                Points -> {
                    if (v !is JsonArray) { error(path, "Expected a list of [x, y] points but found ${describe(v)}."); return }
                    if (v.size() < 3) error(path, "A polygon needs at least 3 points (found ${v.size()}).")
                    if (v.size() > PonderLimits.MAX_POLYGON_POINTS) { error(path, "A polygon may have at most ${PonderLimits.MAX_POLYGON_POINTS} points (found ${v.size()})."); return }
                    v.forEachIndexed { i, p ->
                        if (p !is JsonArray || p.size() != 2) { error("$path[$i]", "Each point must be a pair [x, y]."); return@forEachIndexed }
                        checkNumber("$path[$i][0]", p[0], -PonderLimits.MAX_COORDINATE, PonderLimits.MAX_COORDINATE)
                        checkNumber("$path[$i][1]", p[1], -PonderLimits.MAX_COORDINATE, PonderLimits.MAX_COORDINATE)
                    }
                }
            }
        }

        fun checkEasing(path: String, v: JsonElement?) {
            when {
                v is JsonPrimitive && v.isString ->
                    if (v.asString !in EASINGS) error(path, "Unknown easing \"${v.asString}\".${suggest(v.asString, EASINGS)} Use one of ${EASINGS.joinToString(", ")} or [x1, y1, x2, y2].")
                v is JsonArray && v.size() == 4 ->
                    v.forEachIndexed { i, n -> checkNumber("$path[$i]", n, if (i % 2 == 0) 0.0 else -2.0, if (i % 2 == 0) 1.0 else 3.0) }
                else -> error(path, "Expected an easing name or a cubic-bezier [x1, y1, x2, y2] but found ${describe(v)}.")
            }
        }


        fun validateAnimation(path: String, id: String, a: JsonElement, seen: MutableMap<String, String>): AnimationInfo? {
            if (a !is JsonObject) { error(path, "Expected an object but found ${describe(a)}."); return null }
            val errorsBefore = errors.size
            checkKeys(path, a, ANIMATION_KEYS)
            val autoAdvance = a.get("autoAdvance")
            if (autoAdvance != null && !(autoAdvance is JsonPrimitive && autoAdvance.isBoolean)) {
                if (num(autoAdvance) == null) error("$path.autoAdvance", "Expected true, false or a number of milliseconds but found ${describe(autoAdvance)}.")
                else checkNumber("$path.autoAdvance", autoAdvance, 0.0, PonderLimits.MAX_DELAY_MS)
            }

            var symbol: String? = null
            val aliasList = ArrayList<String>()
            fun symbolOk(p: String, v: JsonElement?): String? {
                val s = checkString(p, v, PonderLimits.MAX_SYMBOL_LENGTH) ?: return null
                if (!isValidSymbol(s)) {
                    error(p, "\"$s\" is not a valid symbol. $SYMBOL_HELP")
                    return null
                }
                val key = PonderSymbols.normalize(s)
                val prev = seen[key]
                if (prev != null) { error(p, "Symbol \"$s\" is already bound by $prev. Each symbol may have only one animation."); return null }
                seen[key] = p
                return s
            }
            symbol = symbolOk("$path.symbol", a.get("symbol"))
            val aliases = a.get("aliases")
            if (aliases != null) {
                if (aliases !is JsonArray) error("$path.aliases", "Expected a list of symbols but found ${describe(aliases)}.")
                else if (aliases.size() > PonderLimits.MAX_ALIASES) error("$path.aliases", "At most ${PonderLimits.MAX_ALIASES} aliases are allowed.")
                else aliases.forEachIndexed { i, s -> symbolOk("$path.aliases[$i]", s)?.let { aliasList += it } }
            }
            val title = checkString("$path.title", a.get("title"), PonderLimits.MAX_TITLE_LENGTH)
            val description = a.get("description")?.let { checkString("$path.description", it, PonderLimits.MAX_DESCRIPTION_LENGTH) }

            // scene
            val scene = a.get("scene")
            if (scene != null) {
                if (scene !is JsonObject) error("$path.scene", "Expected an object but found ${describe(scene)}.")
                else {
                    checkKeys("$path.scene", scene, listOf("width", "height", "background"))
                    for (k in listOf("width", "height")) scene.get(k)?.let {
                        checkNumber("$path.scene.$k", it, PonderLimits.MIN_SCENE_SIZE.toDouble(), PonderLimits.MAX_SCENE_SIZE.toDouble(), true)
                    }
                    scene.get("background")?.let { if (!isColor(it)) error("$path.scene.background", "Expected a color but found ${describe(it)}.") }
                }
            }

            // actors
            val actorTypes = LinkedHashMap<String, String>()
            val parents = HashMap<String, String>()
            val actors = a.get("actors")
            if (actors !is JsonObject) {
                error("$path.actors", if (actors == null) "Required property is missing." else "Expected an object of actors but found ${describe(actors)}.")
            } else {
                actors.get(COMMENT_KEY)?.let { checkComment("$path.actors.$COMMENT_KEY", it) }
                val actorCount = actors.keySet().count { it != COMMENT_KEY }
                if (actorCount == 0) error("$path.actors", "An animation needs at least one actor.")
                if (actorCount > PonderLimits.MAX_ACTORS) error("$path.actors", "Too many actors ($actorCount, maximum ${PonderLimits.MAX_ACTORS}).")
                else {
                    for ((aid, decl) in actors.entrySet()) {
                        if (aid == COMMENT_KEY) continue
                        val p = "$path.actors.$aid"
                        checkId(p, aid, "actor")
                        if (decl !is JsonObject) { error(p, "Expected an object but found ${describe(decl)}."); continue }
                        val type = str(decl.get("type"))
                        if (type == null || type !in ACTOR_TYPES) {
                            error("$p.type", if (decl.get("type") == null) "Required property is missing. Use one of ${ACTOR_TYPES.joinToString(", ")}."
                            else "Unknown actor type ${describe(decl.get("type"))}.${if (type != null) suggest(type, ACTOR_TYPES) else ""} Use one of ${ACTOR_TYPES.joinToString(", ")}.")
                            continue
                        }
                        actorTypes[aid] = type
                        val specs = PROPS.getValue(type)
                        for ((k, v) in decl.entrySet()) {
                            if (k == "type") continue
                            if (k == COMMENT_KEY) { checkComment("$p.$k", v); continue }
                            if (k == "parent") {
                                val ps = str(v)
                                if (ps == null) error("$p.parent", "Expected the id of a group actor but found ${describe(v)}.") else parents[aid] = ps
                                continue
                            }
                            val spec = specs[k]
                            if (spec == null) error("$p.$k", "\"$k\" is not a property of $type actors.${suggest(k, specs.keys + "parent")}")
                            else checkProp("$p.$k", spec, v)
                        }
                        if (type == "polygon" && decl.get("points") == null) error("$p.points", "A polygon actor needs \"points\": [[x, y], [x, y], [x, y], ...].")
                    }
                    for ((aid, parent) in parents) {
                        val p = "$path.actors.$aid.parent"
                        val pt = actorTypes[parent]
                        if (pt == null) error(p, "Parent \"$parent\" is not a declared actor.${suggest(parent, actorTypes.keys)}")
                        else if (pt != "group") error(p, "Parent \"$parent\" is a $pt, but only \"group\" actors can contain other actors.")
                    }
                    for (aid in parents.keys) {
                        var depth = 0; var cur: String? = aid; val seenIds = HashSet<String>()
                        while (cur != null && parents.containsKey(cur)) {
                            if (!seenIds.add(cur)) { error("$path.actors.$aid.parent", "Group nesting forms a cycle through \"$cur\"."); break }
                            cur = parents[cur]
                            if (++depth > PonderLimits.MAX_GROUP_DEPTH) { error("$path.actors.$aid.parent", "Groups are nested deeper than ${PonderLimits.MAX_GROUP_DEPTH} levels."); break }
                        }
                    }
                }
            }

            // slides
            val slideIds = ArrayList<String?>() // per index; null = slide without an id
            val inlineTiming = HashSet<Int>()   // slides that say how they are reached
            val captions = ArrayList<String>()
            val slides = a.get("slides")
            if (slides !is JsonArray) {
                error("$path.slides", if (slides == null) "Required property is missing." else "Expected a list of slides but found ${describe(slides)}.")
            } else if (slides.size() == 0) error("$path.slides", "An animation needs at least one slide.")
            else if (slides.size() > PonderLimits.MAX_SLIDES) error("$path.slides", "Too many slides (${slides.size()}, maximum ${PonderLimits.MAX_SLIDES}).")
            else slides.forEachIndexed { i, s ->
                val p = "$path.slides[$i]"
                if (s !is JsonObject) { error(p, "Expected an object but found ${describe(s)}."); return@forEachIndexed }
                checkKeys(p, s, SLIDE_KEYS)
                var sid: String? = null
                val rawId = s.get("id")
                if (rawId != null) {
                    val idStr = str(rawId)
                    if (idStr == null) error("$p.id", "Expected a string but found ${describe(rawId)}.")
                    else if (checkId("$p.id", idStr, "slide")) {
                        if (idStr in slideIds) error("$p.id", "Duplicate slide id \"$idStr\".")
                        sid = idStr
                    }
                }
                slideIds += sid
                val timing = TIMING_KEYS.filter { s.get(it) != null }
                if (timing.isNotEmpty()) {
                    if (i == 0) error("$p.${timing[0]}", "The first slide is shown as soon as the animation starts, so it cannot have \"${timing[0]}\". Put timing on the slides that follow.")
                    else { inlineTiming += i; checkTiming(p, s, actorTypes.keys) }
                }
                captions += s.get("caption")?.let { checkString("$p.caption", it, PonderLimits.MAX_CAPTION_LENGTH) } ?: ""
                val changes = s.get("changes")
                if (changes != null) {
                    if (changes !is JsonObject) { error("$p.changes", "Expected an object mapping actor ids to property changes but found ${describe(changes)}."); return@forEachIndexed }
                    for ((aid, change) in changes.entrySet()) {
                        val cp = "$p.changes.$aid"
                        if (aid == COMMENT_KEY) { checkComment(cp, change); continue }
                        val type = actorTypes[aid]
                        if (type == null) { error(cp, "Unknown actor \"$aid\".${suggest(aid, actorTypes.keys)} Declare it in \"actors\" first."); continue }
                        if (change !is JsonObject) { error(cp, "Expected an object of properties but found ${describe(change)}."); continue }
                        val specs = PROPS.getValue(type)
                        for ((k, v) in change.entrySet()) {
                            if (k == COMMENT_KEY) { checkComment("$cp.$k", v); continue }
                            if (k == "type" || k == "parent") { error("$cp.$k", "\"$k\" is fixed when the actor is declared and cannot change between slides."); continue }
                            val spec = specs[k]
                            if (spec == null) error("$cp.$k", "\"$k\" is not a property of $type actors.${suggest(k, specs.keys)}")
                            else checkProp("$cp.$k", spec, v)
                        }
                    }
                }
            }

            // transitions
            val targeted = HashSet<String>()
            val byTo = HashMap<String, JsonObject>()
            val transitions = a.get("transitions")
            if (transitions != null) {
                if (transitions !is JsonArray) error("$path.transitions", "Expected a list but found ${describe(transitions)}.")
                else if (transitions.size() > PonderLimits.MAX_TRANSITIONS) error("$path.transitions", "Too many transitions (maximum ${PonderLimits.MAX_TRANSITIONS}).")
                else transitions.forEachIndexed { i, t ->
                    val p = "$path.transitions[$i]"
                    if (t !is JsonObject) { error(p, "Expected an object but found ${describe(t)}."); return@forEachIndexed }
                    checkKeys(p, t, TRANSITION_KEYS)
                    val to = str(t.get("to"))
                    if (to == null) { error("$p.to", if (t.get("to") == null) "Required property is missing." else "Expected a slide id but found ${describe(t.get("to"))}."); return@forEachIndexed }
                    val namedIds = slideIds.filterNotNull()
                    val toIdx = slideIds.indexOf(to)
                    if (toIdx < 0) error("$p.to", "Unknown slide \"$to\".${suggest(to, namedIds)}")
                    else if (toIdx == 0) error("$p.to", "Nothing transitions into the first slide; it is shown as soon as the animation starts.")
                    else {
                        if (to in targeted) error("$p.to", "More than one transition leads to slide \"$to\".")
                        else if (toIdx in inlineTiming) error("$p.to", "Slide \"$to\" already sets its own timing (trigger, duration, ...). Keep it in one place: on the slide or here.")
                        targeted += to
                        byTo[to] = t
                        t.get("from")?.let { f ->
                            val fs = str(f)
                            if (fs == null || fs !in namedIds) error("$p.from", "Unknown slide ${describe(f)}.${if (fs != null) suggest(fs, namedIds) else ""}")
                            else if (slideIds.indexOf(fs) != toIdx - 1) error("$p.from", "Ponder plays slides in order, so \"$to\" can only be reached from the slide just before it${slideIds[toIdx - 1]?.let { " (\"$it\")" } ?: ""}, not \"$fs\".")
                        }
                    }
                    checkTiming(p, t, actorTypes.keys)
                }
            }

            // total running time (defaults included); same merge as the engine's transitionInto():
            // autoAdvance < transitions[] entry < timing fields on the slide. Only meaningful once everything above is valid.
            if (errors.size == errorsBefore && slides is JsonArray && slides.size() > 1) {
                val autoDelay: Double? = when {
                    autoAdvance is JsonPrimitive && autoAdvance.isBoolean -> if (autoAdvance.asBoolean) AUTO_ADVANCE_DELAY else null
                    else -> num(autoAdvance)
                }
                var total = 0.0
                for (i in 1 until slides.size()) {
                    val slide = slides[i] as JsonObject
                    val entry = slideIds[i]?.let { byTo[it] }
                    fun pick(k: String): JsonElement? = slide.get(k) ?: entry?.get(k)
                    val trigger = str(pick("trigger")) ?: if (autoDelay != null) "auto" else "next"
                    val style = str(pick("style")) ?: "fluid"
                    val delay = num(pick("delay")) ?: if (trigger == "auto") (autoDelay ?: 500.0) else 0.0
                    val duration = if (style == "direct") 0.0 else num(pick("duration")) ?: 600.0
                    val stagger = if (style == "direct") 0.0 else num(pick("stagger")) ?: 0.0
                    val order = (pick("order") as? JsonArray)?.size() ?: 0
                    total += delay + duration + stagger * maxOf(0, (if (order > 0) order else actorTypes.size) - 1)
                }
                if (total > PonderLimits.MAX_TOTAL_MS) error("$path.transitions", "Total animation time is ${Math.round(total / 1000)}s, longer than the ${(PonderLimits.MAX_TOTAL_MS / 1000).toInt()}s limit.")
            }

            if (symbol == null || title == null) return null
            return AnimationInfo(id, symbol, aliasList, title, description ?: "", captions)
        }
    }
}
