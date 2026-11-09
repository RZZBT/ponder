package dev.ponder.settings

import com.intellij.openapi.components.service
import com.intellij.openapi.options.BoundSearchableConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.bindIntText
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.panel
import com.intellij.ui.dsl.builder.COLUMNS_TINY
import com.intellij.ui.dsl.builder.columns

class PonderConfigurable : BoundSearchableConfigurable("Ponder", "dev.ponder.settings") {

    override fun createPanel(): DialogPanel {
        val s = service<PonderSettings>().state
        return panel {
            group("Behavior") {
                row { checkBox("Show a gutter icon next to calls that have a Ponder animation").bindSelected(s::showGutterIcon) }
                row { checkBox("Start playing automatically when Ponder opens").bindSelected(s::autoPlay) }
                row {
                    checkBox("Reduce motion (instant steps, no automatic advance)").bindSelected(s::forceReducedMotion)
                        .comment("Ponder also follows the operating system's reduced-motion setting.")
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
