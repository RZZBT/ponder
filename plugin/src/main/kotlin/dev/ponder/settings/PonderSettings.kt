package dev.ponder.settings

import com.intellij.openapi.components.BaseState
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.SimplePersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage

/** The shortcut is configured in Settings | Keymap; everything else is here. */
@Service(Service.Level.APP)
@State(name = "PonderSettings", storages = [Storage("ponder.xml")])
class PonderSettings : SimplePersistentStateComponent<PonderSettings.State>(State()) {

    class State : BaseState() {
        var showGutterIcon by property(true)
        var autoPlay by property(true)
        var forceReducedMotion by property(false)
        var compactWidth by property(640)
        var compactHeight by property(470)
        var expandedWidth by property(980)
        var expandedHeight by property(730)
    }

    companion object {
        const val MIN_SIZE = 360
        const val MAX_SIZE = 3000
    }
}
