package dev.ponder.format

/** Symbol strings; same rules as engine/src/parser/symbol.ts. A prefix names the scheme, no prefix means JVM. */
object PonderSymbols {
    private const val JVM_TYPE = """(?:boolean|byte|char|short|int|long|float|double|[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?:\[\])*"""

    val SCHEMES: Map<String, Regex> = mapOf(
        "jvm" to """[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*#(?:<init>|[A-Za-z_$][\w$]*)\((?:$JVM_TYPE(?:,$JVM_TYPE)*)?\)""",
        "py" to """[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*""",
        "js" to """(?:@[\w.-]+/)?[\w.-]+(?:/[\w.-]+)*#[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*""",
        "dotnet" to """[MTPFE]:[\w.#\x60{}@*\[\],]+(?:\([\w.#\x60{}@*\[\],]*\))?""",
        "go" to """[\w.~-]+(?:/[\w.~-]+)*\.[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?""",
        "rust" to """[A-Za-z_]\w*(?:::[A-Za-z_]\w*)+""",
        "cpp" to """[A-Za-z_]\w*(?:::~?[A-Za-z_]\w*)*(?:\([\w:,*&<> ]*\))?""",
        "sym" to """[\w.-]+(?:/[\w.-]+)*:[^\s:]+""",
    ).mapValues { Regex("^${it.value}$") }

    private val PREFIX = Regex("^([a-z]+):(?!:)")

    data class Parsed(val scheme: String, val body: String)

    fun parse(s: String): Parsed {
        val m = PREFIX.find(s)
        if (m != null && m.groupValues[1] in SCHEMES) return Parsed(m.groupValues[1], s.substring(m.value.length))
        return Parsed("jvm", s)
    }

    fun isValid(s: String): Boolean {
        val (scheme, body) = parse(s)
        if (scheme == "sym" && body.substringBefore(':').split('/').any { it == ".." || it == "." }) return false
        return SCHEMES.getValue(scheme).matches(body)
    }

    /** `jvm:a.B#m()` and `a.B#m()` are the same symbol. */
    fun normalize(s: String): String = parse(s).let { if (it.scheme == "jvm") it.body else s }
}
