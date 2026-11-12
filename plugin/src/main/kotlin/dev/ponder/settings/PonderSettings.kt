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

        /** [ONLINE_ASK] (first use asks), [ONLINE_ON] or [ONLINE_OFF]. */
        var onlineLookup by string(ONLINE_ASK)
        /** Base address of the community index (https). */
        var indexUrl by string(DEFAULT_INDEX_URL)
        /** Extra folders with ponder.json files, one per line. `<project>/.ponder` is always used. */
        var localFolders by string("")
    }

    /** Asked once per IDE session at most, even when the user picks "Not now". */
    @Volatile var askedThisSession = false

    companion object {
        const val MIN_SIZE = 360
        const val MAX_SIZE = 3000

        const val ONLINE_ASK = "ask"
        const val ONLINE_ON = "on"
        const val ONLINE_OFF = "off"

        /** Where the community index will be published (GitHub Pages). Changeable in Settings | Tools | Ponder. */
        const val DEFAULT_INDEX_URL = "https://rzzbt.github.io/ponder-index/"
    }
}
