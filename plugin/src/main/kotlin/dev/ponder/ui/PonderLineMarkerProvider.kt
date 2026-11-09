package dev.ponder.ui

import com.intellij.codeInsight.daemon.GutterIconNavigationHandler
import com.intellij.codeInsight.daemon.LineMarkerInfo
import com.intellij.codeInsight.daemon.LineMarkerProviderDescriptor
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.psi.PsiElement
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.PonderService
import dev.ponder.resolution.PonderSymbolResolver
import dev.ponder.settings.PonderSettings
import javax.swing.Icon

/** Gutter icon next to calls that have an animation. Uses the same lookup as Alt+W, in the slow marker pass. */
class PonderLineMarkerProvider : LineMarkerProviderDescriptor() {

    override fun getName(): String = "Ponder animation"
    override fun getIcon(): Icon = PonderIcons.Ponder

    override fun getLineMarkerInfo(element: PsiElement): LineMarkerInfo<*>? = null

    override fun collectSlowLineMarkers(elements: MutableList<out PsiElement>, result: MutableCollection<in LineMarkerInfo<*>>) {
        if (!service<PonderSettings>().state.showGutterIcon) return
        for (element in elements) {
            if (!isIdentifierLeaf(element)) continue
            val symbol = PonderSymbolResolver.resolveIdentifier(element) ?: continue
            val outcome = element.project.service<PonderService>().evaluate(symbol)
            if (outcome !is MatchOutcome.Found) continue
            val title = outcome.match.animation.title
            result += LineMarkerInfo(
                element,
                element.textRange,
                PonderIcons.Ponder,
                { "Ponder: $title  (Alt+W)" },
                GutterIconNavigationHandler { _, el -> openFor(el) },
                GutterIconRenderer.Alignment.RIGHT,
                { "Ponder animation: $title" },
            )
        }
    }

    private fun isIdentifierLeaf(e: PsiElement): Boolean =
        e.firstChild == null && e.node?.elementType?.toString() == "IDENTIFIER"

    private fun openFor(element: PsiElement) {
        val project = element.project
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
        PonderActivation.activate(project, editor, listOf(element.textRange.startOffset), explicit = true)
    }
}
