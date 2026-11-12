package dev.ponder.resolution

import com.intellij.psi.PsiFile
import org.jetbrains.uast.UastFacade

/** Java, Kotlin and other UAST languages. Registered only when the Java plugin is present (ponder-java.xml). */
class JvmPonderResolver : PonderResolver {
    override fun handles(file: PsiFile): Boolean = UastFacade.findPlugin(file) != null

    override fun resolveAt(file: PsiFile, offset: Int): ResolvedSymbol? = PonderSymbolResolver.resolveAt(file, offset)

    override fun explain(file: PsiFile, offset: Int): dev.ponder.matching.PonderProblem = PonderSymbolResolver.explain(file, offset)

    override fun authoringSymbol(file: PsiFile, offset: Int): String? =
        PonderSymbolResolver.methodForAuthoring(file, offset)?.let { PonderSymbolResolver.symbolString(it) }
}
