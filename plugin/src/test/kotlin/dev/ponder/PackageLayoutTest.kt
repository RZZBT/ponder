package dev.ponder

import dev.ponder.packages.PackageLayout
import junit.framework.TestCase

/** Names the generic resolver reads from declaration text, to match VS Code outlines (vscode/src/outline.ts). */
class PackageLayoutTest : TestCase() {
    fun testGoReceiver() {
        assertEquals("IntStack", PackageLayout.goReceiver("func (s *IntStack) Push(v int) {"))
        assertEquals("IntStack", PackageLayout.goReceiver("func (IntStack) Len() int {"))
        assertNull(PackageLayout.goReceiver("func Clamp(v, lo, hi int) int {"))
    }

    fun testRustImpl() {
        assertEquals("IntStack", PackageLayout.implType("impl IntStack {\n    fn push(&mut self) {}"))
        assertEquals("Stack", PackageLayout.implType("impl<T> Display for Stack<T> {"))
        assertNull(PackageLayout.implType("fn push(&mut self) {}"))
    }
}
