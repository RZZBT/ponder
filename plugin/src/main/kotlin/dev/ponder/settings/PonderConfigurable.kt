package dev.ponder.settings

import com.intellij.openapi.components.service
import com.intellij.openapi.options.BoundSearchableConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.COLUMNS_TINY
import com.intellij.ui.dsl.builder.MutableProperty
import com.intellij.ui.dsl.builder.bind
import com.intellij.ui.dsl.builder.bindIntText
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.rows
import dev.ponder.sources.IndexProtocol
import dev.ponder.sources.LocalFolders
import dev.ponder.sources.OnlineIndex

class PonderConfigurable : BoundSearchableConfigurable("Ponder", "dev.ponder.settings") {

    override fun createPanel(): DialogPanel {
        val settings = service<PonderSettings>()
        val s = settings.state
        return panel {
            group("Behavior") {
                row { checkBox("Show a gutter icon next to calls that have a Ponder animation").bindSelected(s::showGutterIcon) }
                row { checkBox("Start playing automatically when Ponder opens").bindSelected(s::autoPlay) }
                row {
                    checkBox("Reduce motion (instant steps, no automatic advance)").bindSelected(s::forceReducedMotion)
                        .comment("Ponder also follows the operating system's reduced-motion setting.")
                }
            }
            group("Animations for libraries that ship none") {
                buttonsGroup("Look in the community index online:") {
                    row { radioButton("Ask me the first time", PonderSettings.ONLINE_ASK) }
                    row { radioButton("Yes", PonderSettings.ONLINE_ON) }
                    row { radioButton("No, never go online", PonderSettings.ONLINE_OFF) }
                }.bind(MutableProperty({ s.onlineLookup ?: PonderSettings.ONLINE_ASK }, { s.onlineLookup = it }), String::class.java)
                row {
                    comment("For library functions without an animation of their own, and for built-in functions (standard library). Only the library's name is sent (for example pypi/numpy or std/python/builtins), never your code. Found animations are cached for a day and work offline; \"no animation yet\" is checked again after an hour.")
                }
                row("Index address:") {
                    textField()
                        .align(AlignX.FILL)
                        .bindText({ s.indexUrl ?: PonderSettings.DEFAULT_INDEX_URL }, { s.indexUrl = it.trim() })
                        .validationOnInput { if (IndexProtocol.normalizeBaseUrl(it.text) == null) error("Use an https:// address") else null }
                        .validationOnApply { if (IndexProtocol.normalizeBaseUrl(it.text) == null) error("Use an https:// address") else null }
                }
                row {
                    button("Clear Cached Animations") {
                        service<OnlineIndex>().clearCache()
                        service<LocalFolders>().clearCache()
                    }.comment("Forget what was downloaded; it is fetched again when needed.")
                }
                row("Local folders:") {
                    textArea()
                        .rows(3)
                        .align(AlignX.FILL)
                        .bindText({ s.localFolders.orEmpty() }, { s.localFolders = it })
                        .comment("One folder per line, with ponder.json files you made or downloaded. The project's own " +
                            "<code>.ponder</code> folder is always used.")
                }
            }
            group("Window size (px)") {
                row("Compact:") {
                    intTextField(PonderSettings.MIN_SIZE..PonderSettings.MAX_SIZE).columns(COLUMNS_TINY).bindIntText(s::compactWidth)
                    label("x")
                    intTextField(PonderSettings.MIN_SIZE..PonderSettings.MAX_SIZE).columns(COLUMNS_TINY).bindIntText(s::compactHeight)
                }
                row("Expanded:") {
                    intTextField(PonderSettings.MIN_SIZE..PonderSettings.MAX_SIZE).columns(COLUMNS_TINY).bindIntText(s::expandedWidth)
                    label("x")
                    intTextField(PonderSettings.MIN_SIZE..PonderSettings.MAX_SIZE).columns(COLUMNS_TINY).bindIntText(s::expandedHeight)
                }
            }
            group("Shortcut") {
                row {
                    comment(
                        "<b>Alt+W</b> opens Ponder for the call under the mouse pointer or the caret. " +
                            "Change it under <i>Settings | Keymap</i>, action <i>Open Ponder</i>."
                    )
                }
            }
        }
    }
}
