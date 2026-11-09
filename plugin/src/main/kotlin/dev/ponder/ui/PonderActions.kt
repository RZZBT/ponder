package dev.ponder.ui

import com.intellij.codeInsight.hint.HintManager
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.psi.PsiDocumentManager
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.concurrency.AppExecutorUtil
import com.intellij.util.ui.JBUI
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.resolution.PonderResolver
import java.awt.Dimension
import java.awt.datatransfer.StringSelection
import java.awt.event.ActionEvent
import javax.swing.AbstractAction
import javax.swing.Action
import javax.swing.JComponent
import javax.swing.JTextArea

abstract class PonderEditorAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible =
            e.project != null && e.getData(CommonDataKeys.EDITOR) != null && e.getData(CommonDataKeys.PSI_FILE) != null
    }
}

/** Default shortcut Alt+W (see plugin.xml). */
class OpenPonderAction : PonderEditorAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        PonderActivation.activate(project, editor, PonderActivation.candidateOffsets(editor), explicit = true)
    }
}

/** Copies the `symbol` string for the method at the caret, for library authors. */
class CopyPonderSymbolAction : PonderEditorAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val docs = PsiDocumentManager.getInstance(project)
        docs.commitDocument(editor.document)
        val offset = editor.caretModel.offset
        ReadAction.nonBlocking<String?> {
            val file = docs.getPsiFile(editor.document) ?: return@nonBlocking null
            PonderResolver.forFile(file)?.authoringSymbol(file, offset)
        }
            .inSmartMode(project)
            .finishOnUiThread(ModalityState.nonModal()) { symbol ->
                if (editor.isDisposed) return@finishOnUiThread
                val hints = HintManager.getInstance()
                if (symbol == null) {
                    hints.showInformationHint(editor, "Put the caret on a function or method name (a call or its declaration).")
                } else {
                    CopyPasteManager.getInstance().setContents(StringSelection(symbol))
                    hints.showInformationHint(editor, "Copied: $symbol")
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }
}

class ShowPonderDiagnosticsAction : AnAction(), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT
    override fun actionPerformed(e: AnActionEvent) { DiagnosticsDialog(e.project).show() }

    private class DiagnosticsDialog(project: Project?) : DialogWrapper(project) {
        private val area = JTextArea().apply { isEditable = false; lineWrap = true; wrapStyleWord = true }

        init {
            title = "Ponder Diagnostics"
            refresh()
            init()
        }

        private fun refresh() {
            val entries = service<PonderDiagnostics>().snapshot()
            area.text = if (entries.isEmpty()) "No problems recorded." else entries.joinToString("\n\n") { "${it.time}\n$it" }
            area.caretPosition = 0
        }

        override fun createCenterPanel(): JComponent =
            JBScrollPane(area).apply { preferredSize = Dimension(JBUI.scale(760), JBUI.scale(380)) }

        override fun createActions(): Array<Action> = arrayOf(
            object : AbstractAction("Clear") {
                override fun actionPerformed(ev: ActionEvent?) {
                    service<PonderDiagnostics>().clear()
                    refresh()
                }
            },
            okAction,
        )
    }
}
