package dev.ponder.otheride

import com.intellij.codeInsight.CodeInsightSettings
import com.intellij.openapi.application.runReadActionBlocking
import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.PonderRegistry
import dev.ponder.matching.PonderService

/**
 * Python, Rust and C++ through the generic resolver. Runs inside CLion, which bundles all three:
 *   ./gradlew :plugin:testCLion "-PclionDir=C:/Program Files/JetBrains/CLion 2026.2.3.1"
 * Excluded from the normal test task (IntelliJ IDEA has none of these languages).
 */
class OtherIdeLanguagesTest : BasePlatformTestCase() {

    override fun setUp() {
        super.setUp()
        project.service<PonderRegistry>().invalidateAll()
    }

    override fun tearDown() {
        // CLion switches this on while it starts up; the test framework then reports "Code insight settings damaged"
        CodeInsightSettings.getInstance().AUTO_POPUP_JAVADOC_INFO = false
        super.tearDown()
    }

    private fun ponderJson(library: String, vararg symbols: Pair<String, String>) = """
        { "version": 1, "library": { "name": "$library" }, "animations": {
        ${symbols.joinToString(",\n") { (id, s) -> """"$id": { "symbol": "$s", "title": "$id", "actors": { "x": { "type": "circle", "radius": 5 } }, "slides": [ {}, { "changes": { "x": { "x": 9 } } } ] }""" }}
        } }
    """.trimIndent()

    private fun outcomeAt(path: String, textWithCaret: String): MatchOutcome {
        val caret = textWithCaret.indexOf("<caret>")
        val file = myFixture.addFileToProject(path, textWithCaret.replace("<caret>", ""))
        myFixture.configureFromExistingVirtualFile(file.virtualFile)
        myFixture.editor.caretModel.moveToOffset(caret)
        return runReadActionBlocking { project.service<PonderService>().findAt(myFixture.file, caret) }
    }

    private fun MatchOutcome.describe() = when (this) {
        is MatchOutcome.Found -> "found ${match.animation.id} via ${match.symbol.signature}"
        is MatchOutcome.NotFound -> "not found: $reason ${detail ?: ""}"
    }

    private fun assertFound(id: String, outcome: MatchOutcome) {
        assertTrue(outcome.describe(), outcome is MatchOutcome.Found && outcome.match.animation.id == id)
    }

    // ---- Python

    private fun pythonLib() {
        myFixture.addFileToProject("pyutils/__init__.py", "from pyutils.stack import IntStack\n\n\ndef clamp(value, minimum, maximum):\n    return max(minimum, min(maximum, value))\n")
        myFixture.addFileToProject("pyutils/stack.py", "class IntStack:\n    def push(self, value):\n        pass\n")
        myFixture.addFileToProject("pyutils/ponder.json", ponderJson("pyutils", "clamp" to "py:pyutils.clamp", "push" to "py:pyutils.stack.IntStack.push"))
    }

    fun testPythonFunction() {
        pythonLib()
        assertFound("clamp", outcomeAt("main.py", "from pyutils import clamp\n\nx = cl<caret>amp(-4, 0, 10)\n"))
    }

    fun testPythonMethod() {
        pythonLib()
        assertFound("push", outcomeAt("main.py", "from pyutils.stack import IntStack\n\ns = IntStack()\ns.pu<caret>sh(3)\n"))
    }

    fun testPythonLocalFunction() {
        pythonLib()
        val o = outcomeAt("main.py", "def clamp(v, a, b):\n    return v\n\nx = cl<caret>amp(1, 2, 3)\n")
        assertTrue(o.describe(), o is MatchOutcome.NotFound)
    }

    // ---- Rust (one crate; resolution inside a file needs no cargo project model)

    fun testRustFunction() {
        myFixture.addFileToProject("rmath/Cargo.toml", "[package]\nname = \"rmath\"\nversion = \"1.0.0\"\n")
        myFixture.addFileToProject("rmath/ponder.json", ponderJson("rmath", "clamp" to "rust:rmath::clamp", "push" to "rust:rmath::IntStack::push"))
        val code = """
            pub struct IntStack { items: Vec<i32> }
            impl IntStack {
                pub fn push(&mut self, v: i32) { self.items.push(v); }
            }
            pub fn clamp(v: i32, a: i32, b: i32) -> i32 { v.max(a).min(b) }
            fn demo(s: &mut IntStack) { CLAMP; PUSH; }
        """.trimIndent()
        assertFound("clamp", outcomeAt("rmath/src/lib.rs", code.replace("CLAMP", "cl<caret>amp(1, 2, 3)").replace("PUSH", "s.push(3)")))
    }

    /** Known limitation of the test project: without a Cargo project model the Rust plugin does not find impl members. */
    fun testRustImplMethodNeedsACargoProject() {
        myFixture.addFileToProject("rmath/Cargo.toml", "[package]\nname = \"rmath\"\nversion = \"1.0.0\"\n")
        myFixture.addFileToProject("rmath/ponder.json", ponderJson("rmath", "push" to "rust:rmath::IntStack::push"))
        val code = """
            pub struct IntStack { items: Vec<i32> }
            impl IntStack {
                pub fn push(&mut self, v: i32) { self.items.push(v); }
            }
            fn demo(s: &mut IntStack) { IntStack::pu<caret>sh(s, 3); }
        """.trimIndent()
        val o = outcomeAt("rmath/src/lib.rs", code)
        assertTrue("now resolves; turn this into a normal test: ${o.describe()}", o is MatchOutcome.NotFound && o.reason == MatchOutcome.Reason.NOT_APPLICABLE)
    }

    // ---- C++

    /** Known limitation: CLion resolves C++ in its language backend, which plain PSI references do not reach. */
    fun testCppIsNotResolvedThroughPsi() {
        myFixture.addFileToProject("cmath-lib/ponder.json", ponderJson("cmath-lib", "clamp" to "cpp:cm::clamp"))
        val code = "namespace cm {\ninline int clamp(int v, int a, int b) { return v < a ? a : (v > b ? b : v); }\n}\nint main() { return cm::cl<caret>amp(1, 2, 3); }\n"
        val o = outcomeAt("cmath-lib/demo.cpp", code)
        assertTrue("now resolves; turn this into a normal test: ${o.describe()}", o is MatchOutcome.NotFound && o.reason == MatchOutcome.Reason.NOT_APPLICABLE)
    }
}
