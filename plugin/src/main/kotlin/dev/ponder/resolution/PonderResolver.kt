package dev.ponder.resolution

import com.intellij.openapi.extensions.ExtensionPointName
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile

class ResolvedSymbol(
    val identity: SymbolIdentity,
    /** The element at the use site; used to place the popup. */
    val useSite: PsiElement,
)

/**
 * Turns an editor position into a [ResolvedSymbol]. The first registered resolver that [handles] a file is the
 * only one asked about it: Java/Kotlin first (JVM signatures), then the generic one for every other language.
 *
 * All functions are called in a read action.
 */
interface PonderResolver {
    fun handles(file: PsiFile): Boolean

    fun resolveAt(file: PsiFile, offset: Int): ResolvedSymbol?

    /** Why [resolveAt] found nothing, in words a user can act on. */
    fun explain(file: PsiFile, offset: Int): String

    /** The `symbol` string for the declaration or call at [offset], for library authors. */
    fun authoringSymbol(file: PsiFile, offset: Int): String?

    companion object {
        val EP = ExtensionPointName<PonderResolver>("dev.ponder.resolver")

        fun forFile(file: PsiFile): PonderResolver? = EP.extensionList.firstOrNull { it.handles(file) }
    }
}
