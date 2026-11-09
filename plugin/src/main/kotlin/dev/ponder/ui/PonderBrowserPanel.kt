package dev.ponder.ui

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.util.Disposer
import com.intellij.ui.JBColor
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import dev.ponder.bridge.BridgeMessage
import dev.ponder.bridge.BridgeMessages
import dev.ponder.bridge.PonderHtml
import dev.ponder.bridge.StartOptions
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.diagnostics.Severity
import dev.ponder.matching.PonderMatch
import dev.ponder.settings.PonderSettings
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLifeSpanHandlerAdapter
import org.cef.handler.CefLoadHandlerAdapter
import org.cef.handler.CefRequestHandlerAdapter
import org.cef.network.CefRequest
import java.awt.BorderLayout
import java.awt.Color
import javax.swing.JComponent
import javax.swing.JPanel

/** What the page may ask the popup to do. */
interface PonderPanelHost {
    fun close()
    fun setExpanded(expanded: Boolean)
}

/** Hosts the engine in JCEF. Popups and navigation are blocked; messages back go through [BridgeMessages]. */
class PonderBrowserPanel(
    private val match: PonderMatch,
    private val host: PonderPanelHost,
    parent: Disposable,
) : JPanel(BorderLayout()), Disposable {

    private val log = thisLogger()
    private val browser: JBCefBrowser = JBCefBrowser.createBuilder().setOffScreenRendering(true).build()
    private val query = JBCefJSQuery.create(browser as JBCefBrowserBase)
    @Volatile private var disposed = false

    val focusTarget: JComponent get() = browser.component

    init {
        Disposer.register(parent, this)
        Disposer.register(this, browser)
        Disposer.register(this, query)

        browser.setProperty(JBCefBrowserBase.Properties.NO_CONTEXT_MENU, true)
        add(browser.component, BorderLayout.CENTER)
        border = JBUI.Borders.empty()

        query.addHandler { raw ->
            handle(BridgeMessages.parse(raw))
            null
        }

        val client = browser.jbCefClient
        client.addLifeSpanHandler(object : CefLifeSpanHandlerAdapter() {
            override fun onBeforePopup(b: CefBrowser?, f: CefFrame?, targetUrl: String?, targetFrameName: String?) = true
        }, browser.cefBrowser)
        client.addRequestHandler(object : CefRequestHandlerAdapter() {
            override fun onBeforeBrowse(b: CefBrowser?, f: CefFrame?, request: CefRequest?, userGesture: Boolean, isRedirect: Boolean) = userGesture
        }, browser.cefBrowser)
        client.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                if (frame?.isMain == true) startAnimation()
            }
        }, browser.cefBrowser)

        val bg = hex(UIUtil.getPanelBackground())
        browser.loadHTML(PonderHtml.page(PonderHtml.newNonce(), bg))
    }

    private fun startAnimation() {
        if (disposed) return
        val settings = service<PonderSettings>().state
        val options = StartOptions(
            dark = !JBColor.isBright(),
            autoplay = settings.autoPlay,
            reducedMotion = if (settings.forceReducedMotion) true else null,
            colors = mapOf(
                "background" to hex(UIUtil.getPanelBackground()),
                "foreground" to hex(UIUtil.getLabelForeground()),
                "muted" to hex(UIUtil.getContextHelpForeground()),
                "accent" to hex(JBUI.CurrentTheme.Link.Foreground.ENABLED),
                "border" to hex(JBColor.border()),
            ),
        )
        val script = "window.__ponderPost = function(m){ ${query.inject("m")} };\n" +
            PonderHtml.startScript(match.document.text, match.animation.id, options)
        browser.cefBrowser.executeJavaScript(script, browser.cefBrowser.url, 0)
    }

    private fun handle(msg: BridgeMessage?) {
        if (disposed || msg == null) return
        ApplicationManager.getApplication().invokeLater({
            if (disposed) return@invokeLater
            when (msg) {
                BridgeMessage.Ready -> Unit
                BridgeMessage.Close -> host.close()
                is BridgeMessage.ToggleExpand -> host.setExpanded(msg.expanded)
                is BridgeMessage.Error -> {
                    log.warn("Ponder renderer rejected ${match.sourceDescription}: ${msg.message}")
                    service<PonderDiagnostics>().record(Severity.ERROR, match.sourceDescription, "renderer: ${msg.message}")
                }
            }
        }, { disposed })
    }

    override fun dispose() {
        disposed = true
    }

    private fun hex(c: Color) = String.format("#%02x%02x%02x", c.red, c.green, c.blue)
}
