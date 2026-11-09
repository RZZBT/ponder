package dev.ponder.ui

import com.intellij.codeInsight.hint.HintManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ex.util.EditorUtil
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiDocumentManager
import com.intellij.util.concurrency.AppExecutorUtil
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.PonderService

/** Shared by the shortcut, the context menu action and the gutter icon. Resolution runs in a background read action. */
object PonderActivation {
    private val log = thisLogger()

    /** The offset under the mouse pointer first, then the caret. */
    fun candidateOffsets(editor: Editor): List<Int> {
        val out = LinkedHashSet<Int>()
        hoverOffset(editor)?.let { out += it }
        out += editor.caretModel.offset
        return out.toList()
    }

    fun hoverOffset(editor: Editor): Int? {
        val p = editor.contentComponent.mousePosition ?: return null
        val logical = editor.visualToLogicalPosition(editor.xyToVisualPosition(p))
        if (EditorUtil.inVirtualSpace(editor, logical)) return null
        return editor.logicalPositionToOffset(logical)
    }

    /**
     * Opens the popup for the first offset that has an animation. When [explicit] (shortcut or menu) and nothing
     * matched, shows a hint with the reason.
     */
    fun activate(project: Project, editor: Editor, offsets: List<Int>, explicit: Boolean) {
        val psiManager = PsiDocumentManager.getInstance(project)
        psiManager.commitDocument(editor.document)

        class Result(val found: Pair<MatchOutcome.Found, Int>?, val why: String)

        ReadAction.nonBlocking<Result> {
            val file = psiManager.getPsiFile(editor.document) ?: return@nonBlocking Result(null, "no file")
            val service = project.service<PonderService>()
            var why = "the caret is not on a method name"
            for (offset in offsets) {
                val outcome = service.findAt(file, offset)
                if (outcome is MatchOutcome.Found) return@nonBlocking Result(outcome to offset, "")
                if (outcome is MatchOutcome.NotFound) {
                    why = reason(outcome)
                    if (outcome.reason != MatchOutcome.Reason.NOT_APPLICABLE) break // a real call; keep its reason
                }
            }
            Result(null, why)
        }
            .inSmartMode(project)
            .expireWith(project.service<PonderPopupController>())
            .finishOnUiThread(ModalityState.nonModal()) { result ->
                if (editor.isDisposed) return@finishOnUiThread
                val found = result.found
                if (found != null) {
                    project.service<PonderPopupController>().open(editor, found.first.match, found.second)
                } else if (explicit) {
                    log.info("Ponder: no animation at offsets $offsets: ${result.why}")
                    HintManager.getInstance().showInformationHint(editor, "No Ponder animation: ${result.why}")
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }

    private fun reason(outcome: MatchOutcome.NotFound): String {
        val d = outcome.detail
        return when (outcome.reason) {
            MatchOutcome.Reason.NOT_APPLICABLE -> d ?: "nothing resolved here"
            MatchOutcome.Reason.NO_METADATA -> d ?: "the library has no META-INF/ponder/ponder.json"
            MatchOutcome.Reason.INVALID_METADATA -> "the library's ponder.json is invalid (Tools | Ponder: Show Diagnostics)" + (d?.let { ": $it" } ?: "")
            MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED -> "the library has no animation for ${d ?: "this signature"}"
            MatchOutcome.Reason.LIBRARY_MISMATCH -> "the library's ponder.json is for a different library" + (d?.let { ": $it" } ?: "")
        }
    }
}
