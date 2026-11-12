package dev.ponder.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.util.Disposer
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.ponder.matching.PonderMatch
import java.awt.BorderLayout
import java.awt.Font
import java.awt.event.KeyAdapter
import java.awt.event.KeyEvent
import javax.swing.DefaultListModel
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.ListSelectionModel

/** Shown when JCEF is unavailable: the slide captions as a list. */
class PonderFallbackPanel(
    match: PonderMatch,
    private val host: PonderPanelHost,
    parent: Disposable,
) : JPanel(BorderLayout()), Disposable {

    private val list: JBList<String>

    val focusTarget: JComponent get() = list

    init {
        Disposer.register(parent, this)
        border = JBUI.Borders.empty(12)

        val header = JPanel(BorderLayout()).apply {
            add(JBLabel(match.animation.title).apply { font = font.deriveFont(Font.BOLD, font.size2D + 2f) }, BorderLayout.NORTH)
            val sub = listOf(match.animation.description, match.sourceLabel).filter { it.isNotBlank() }.joinToString("  ·  ")
            if (sub.isNotBlank()) add(JBLabel(sub).apply { foreground = UIUtil.getContextHelpForeground() }, BorderLayout.CENTER)
            add(JBLabel("<html><i>The interactive animation needs JCEF, which this IDE runtime does not provide. " +
                "Showing the steps as text. Press Esc to close.</i></html>").apply { border = JBUI.Borders.empty(8, 0) }, BorderLayout.SOUTH)
            border = JBUI.Borders.emptyBottom(6)
        }
        add(header, BorderLayout.NORTH)

        val model = DefaultListModel<String>()
        match.animation.captions.forEachIndexed { i, c -> model.addElement("${i + 1}.  ${c.ifBlank { "(no caption)" }}") }
        list = JBList(model).apply {
            selectionMode = ListSelectionModel.SINGLE_SELECTION
            if (model.size() > 0) selectedIndex = 0
            addKeyListener(object : KeyAdapter() {
                override fun keyPressed(e: KeyEvent) { if (e.keyCode == KeyEvent.VK_ESCAPE) host.close() }
            })
        }
        add(JBScrollPane(list), BorderLayout.CENTER)
    }

    override fun dispose() = Unit
}
