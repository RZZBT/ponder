package dev.ponder.ui

import com.intellij.ui.jcef.JBCefApp

/** JCEF is an optional dependency; JCEF classes are only touched after this check. */
object PonderJcef {
    val available: Boolean by lazy {
        try {
            JBCefApp.isSupported()
        } catch (t: Throwable) { // NoClassDefFoundError, UnsatisfiedLinkError
            false
        }
    }
}
