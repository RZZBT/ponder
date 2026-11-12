package dev.ponder.ui

import com.intellij.codeInsight.hint.HintManager
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ex.util.EditorUtil
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiDocumentManager
import com.intellij.util.concurrency.AppExecutorUtil
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.Origin
import dev.ponder.matching.PonderMatch
import dev.ponder.matching.PonderService
import dev.ponder.resolution.SymbolIdentity
import dev.ponder.settings.PonderSettings
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey

/**
 * Shared by the shortcut, the context menu action and the gutter icon.
 *
 * 1. Resolution and every local source run in a background read action.
 * 2. If the library has nothing and its package is known, the online index is fetched in a cancellable background
 *    task (never in a read action, never on the UI thread). The very first time, the user is asked once.
 * 3. The popup opens on the UI thread. Every "nothing found" path ends in a short, friendly hint.
 */
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

    /** What the background read action found. */
    private class Result(
        val found: Pair<MatchOutcome.Found, Int>?,
        val why: String,
        /** A declaration whose package could still have an animation online. */
        val remote: Remote?,
    )

    private class Remote(val symbol: SymbolIdentity, val key: PackageKey, val offset: Int, val localWhy: String)

    /**
     * Opens the popup for the first offset that has an animation. When [explicit] (shortcut or menu) and nothing
     * matched, shows a hint with the reason.
     */
    fun activate(project: Project, editor: Editor, offsets: List<Int>, explicit: Boolean) {
        val psiManager = PsiDocumentManager.getInstance(project)
        psiManager.commitDocument(editor.document)

        ReadAction.nonBlocking<Result> {
            val file = psiManager.getPsiFile(editor.document) ?: return@nonBlocking Result(null, "this file cannot be read", null)
            val service = project.service<PonderService>()
            var why = "put the caret on a function or method name"
            var remote: Remote? = null
            for (offset in offsets) {
                val outcome = service.findAt(file, offset)
                if (outcome is MatchOutcome.Found) return@nonBlocking Result(outcome to offset, "", null)
                if (outcome is MatchOutcome.NotFound) {
                    why = reason(outcome)
                    val key = outcome.packageKey
                    val symbol = outcome.symbol
                    if (remote == null && key != null && symbol != null) remote = Remote(symbol, key, offset, why)
                    if (outcome.reason != MatchOutcome.Reason.NOT_APPLICABLE) break // a real call; keep its reason
                }
            }
            Result(null, why, remote)
        }
            .inSmartMode(project)
            .expireWith(project.service<PonderPopupController>())
            .finishOnUiThread(ModalityState.nonModal()) { result ->
                if (editor.isDisposed || project.isDisposed) return@finishOnUiThread
                val found = result.found
                when {
                    found != null -> {
                        open(project, editor, found.first, found.second)
                        refreshIfOnline(found.first.match)
                    }
                    result.remote != null && explicit -> tryOnline(project, editor, result.remote)
                    explicit -> hint(editor, "No Ponder animation: ${result.why}")
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }

    // ------------------------------------------------------------------ online

    /** An animation shown from the index cache: if that copy is old, quietly fetch a newer one for next time. */
    private fun refreshIfOnline(match: PonderMatch) {
        val key = match.packageKey ?: return
        if (match.origin != Origin.ONLINE_INDEX) return
        val settings = service<PonderSettings>().state
        if (settings.onlineLookup != PonderSettings.ONLINE_ON) return
        service<OnlineIndex>().refreshInBackground(settings.indexUrl.orEmpty(), key)
    }

    private fun tryOnline(project: Project, editor: Editor, remote: Remote) {
        val settingsService = service<PonderSettings>()
        val settings = settingsService.state
        val index = service<OnlineIndex>()
        val base = settings.indexUrl.orEmpty()
        val name = remote.symbol.displayName

        when {
            settings.onlineLookup == PonderSettings.ONLINE_OFF ->
                hint(editor, "No Ponder animation: ${remote.localWhy}")
            !index.needsFetch(base, remote.key) -> {
                // checked recently and the cache had nothing for this function (a hit would have opened already)
                val cached = index.cached(base, remote.key)
                hint(editor, notFoundOnline(name, cached))
            }
            settings.onlineLookup == PonderSettings.ONLINE_ASK -> askConsent(project, editor, remote)
            else -> fetchAndShow(project, editor, remote)
        }
    }

    private fun askConsent(project: Project, editor: Editor, remote: Remote) {
        val settingsService = service<PonderSettings>()
        if (settingsService.askedThisSession) {
            hint(editor, "No Ponder animation: ${remote.localWhy}")
            return
        }
        settingsService.askedThisSession = true
        hint(editor, "No animation in the library. Ponder can look for one online (see the notification).")
        NotificationGroupManager.getInstance().getNotificationGroup("Ponder")
            .createNotification(
                "Look for Ponder animations online?",
                "When a library has no animation of its own, Ponder can check the community index. " +
                    "Only the package name is sent (for example <b>${remote.key.ecosystem}/${remote.key.name}</b>), never your code. " +
                    "You can change this any time in Settings | Tools | Ponder.",
                NotificationType.INFORMATION,
            )
            .addAction(NotificationAction.createSimpleExpiring("Allow") {
                settingsService.state.onlineLookup = PonderSettings.ONLINE_ON
                if (!editor.isDisposed && !project.isDisposed) fetchAndShow(project, editor, remote)
            })
            .addAction(NotificationAction.createSimpleExpiring("Not now") { })
            .addAction(NotificationAction.createSimpleExpiring("Never") {
                settingsService.state.onlineLookup = PonderSettings.ONLINE_OFF
            })
            .notify(project)
    }

    private fun fetchAndShow(project: Project, editor: Editor, remote: Remote) {
        val base = service<PonderSettings>().state.indexUrl.orEmpty()
        object : Task.Backgroundable(project, "Ponder: looking for an animation online", true) {
            private var lookup: OnlineIndex.Lookup? = null
            private var found: MatchOutcome.Found? = null

            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                val l = service<OnlineIndex>().fetch(base, remote.key)
                lookup = l
                indicator.checkCanceled()
                found = project.service<PonderService>().evaluateFetched(remote.symbol, remote.key, l)
            }

            override fun onSuccess() {
                if (editor.isDisposed || project.isDisposed) return
                val f = found
                if (f != null) open(project, editor, f, remote.offset) else hint(editor, notFoundOnline(remote.symbol.displayName, lookup))
            }

            override fun onThrowable(error: Throwable) {
                log.warn("Ponder: online lookup failed", error)
                if (!editor.isDisposed) hint(editor, "No Ponder animation: the community index could not be checked.")
            }
        }.queue()
    }

    private fun notFoundOnline(name: String, lookup: OnlineIndex.Lookup?): String = when (lookup) {
        is OnlineIndex.Lookup.Failed ->
            "No Ponder animation for $name in the library, and the community index could not be checked (${lookup.reason})."
        else -> "No Ponder animation for $name yet: neither the library nor the community index has one."
    }

    // ------------------------------------------------------------------ UI

    private fun open(project: Project, editor: Editor, found: MatchOutcome.Found, offset: Int) {
        val safeOffset = offset.coerceIn(0, editor.document.textLength) // the text may have changed meanwhile
        try {
            project.service<PonderPopupController>().open(editor, found.match, safeOffset)
        } catch (e: Exception) {
            log.warn("Ponder: could not open the popup", e)
            hint(editor, "Ponder could not open its window. Tools | Ponder: Show Diagnostics may say why.")
        }
    }

    private fun hint(editor: Editor, text: String) {
        if (editor.isDisposed) return
        log.info("Ponder: $text")
        HintManager.getInstance().showInformationHint(editor, text)
    }

    private fun reason(outcome: MatchOutcome.NotFound): String {
        val d = outcome.detail
        return when (outcome.reason) {
            MatchOutcome.Reason.NOT_APPLICABLE -> d ?: "nothing resolved here"
            MatchOutcome.Reason.NO_METADATA -> d ?: "the library has no animations"
            MatchOutcome.Reason.INVALID_METADATA -> "the library's ponder.json has a problem (Tools | Ponder: Show Diagnostics)"
            MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED -> "the library has no animation for ${d ?: "this function"}"
            MatchOutcome.Reason.LIBRARY_MISMATCH -> "the library's ponder.json is for a different library (Tools | Ponder: Show Diagnostics)"
        }
    }
}
