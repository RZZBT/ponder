package dev.ponder.ui

import com.intellij.openapi.Disposable
import com.intellij.util.concurrency.ThreadingAssertions
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.ui.popup.JBPopupListener
import com.intellij.openapi.ui.popup.LightweightWindowEvent
import com.intellij.openapi.util.Disposer
import com.intellij.ui.ScreenUtil
import com.intellij.ui.awt.RelativePoint
import dev.ponder.matching.PonderMatch
import dev.ponder.settings.PonderSettings
import java.awt.Dimension
import java.awt.Point
import java.awt.Rectangle
import javax.swing.JComponent

/** The project's single Ponder popup. Opening a new one closes the previous one. */
@Service(Service.Level.PROJECT)
class PonderPopupController(private val project: Project) : Disposable {

    private var popup: JBPopup? = null
    private var expanded = false

    val isOpen: Boolean get() = popup?.isVisible == true

    fun open(editor: Editor, match: PonderMatch, anchorOffset: Int) {
        ThreadingAssertions.assertEventDispatchThread()
        close()

        val settings = service<PonderSettings>().state
        expanded = false
        val lifetime = Disposer.newDisposable("ponder-popup")
        lateinit var created: JBPopup

        val host = object : PonderPanelHost {
            override fun close() { created.cancel() }
            override fun setExpanded(expanded: Boolean) { this@PonderPopupController.resize(created, expanded) }
        }

        val content: JComponent
        val focus: JComponent
        if (PonderJcef.available) {
            val p = PonderBrowserPanel(match, host, lifetime); content = p; focus = p.focusTarget
        } else {
            val p = PonderFallbackPanel(match, host, lifetime); content = p; focus = p.focusTarget
        }

        created = JBPopupFactory.getInstance().createComponentPopupBuilder(content, focus)
            .setRequestFocus(true)
            .setFocusable(true)
            .setResizable(true)
            .setMovable(true)
            .setCancelOnClickOutside(true)
            .setCancelOnOtherWindowOpen(true)
            .setCancelKeyEnabled(true)
            .setLocateWithinScreenBounds(true)
            .setMinSize(Dimension(PonderSettings.MIN_SIZE, 280))
            .setShowShadow(true)
            .createPopup()
        Disposer.register(created, lifetime)
        popup = created
        created.addListener(object : JBPopupListener {
            override fun onClosed(event: LightweightWindowEvent) { if (popup === created) popup = null }
        })

        val size = clampSize(Dimension(settings.compactWidth, settings.compactHeight))
        show(created, editor, anchorOffset, size)
    }

    fun close() {
        popup?.cancel()
        popup = null
    }

    /** Below the call, or above it when there is no room below. */
    private fun show(popup: JBPopup, editor: Editor, offset: Int, requested: Dimension) {
        val anchor = RelativePoint(editor.contentComponent, editor.visualPositionToXY(editor.offsetToVisualPosition(offset))).screenPoint
        val screen = ScreenUtil.getScreenRectangle(anchor)
        val size = Dimension(minOf(requested.width, screen.width - 16), minOf(requested.height, screen.height - 16))
        val x = anchor.x.coerceIn(screen.x + 8, maxOf(screen.x + 8, screen.x + screen.width - size.width - 8))
        val below = anchor.y + editor.lineHeight + 4
        val y = when {
            below + size.height <= screen.y + screen.height - 8 -> below
            anchor.y - size.height - 4 >= screen.y + 8 -> anchor.y - size.height - 4
            else -> maxOf(screen.y + 8, screen.y + screen.height - size.height - 8)
        }
        popup.size = size
        popup.showInScreenCoordinates(editor.contentComponent, Point(x, y))
    }

    private fun resize(popup: JBPopup, expand: Boolean) {
        if (!popup.isVisible) return
        expanded = expand
        val s = service<PonderSettings>().state
        val wanted = clampSize(if (expand) Dimension(s.expandedWidth, s.expandedHeight) else Dimension(s.compactWidth, s.compactHeight))
        val loc = popup.locationOnScreen
        val screen = ScreenUtil.getScreenRectangle(loc)
        val size = Dimension(minOf(wanted.width, screen.width - 16), minOf(wanted.height, screen.height - 16))
        val bounds = Rectangle(loc, size)
        ScreenUtil.moveToFit(bounds, screen, null)
        popup.size = size
        popup.setLocation(bounds.location)
    }

    private fun clampSize(d: Dimension) = Dimension(
        d.width.coerceIn(PonderSettings.MIN_SIZE, PonderSettings.MAX_SIZE),
        d.height.coerceIn(280, PonderSettings.MAX_SIZE),
    )

    override fun dispose() = close()
}
