package dev.ponder.ui

import com.intellij.codeInsight.hint.HintManager
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.ex.util.EditorUtil
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiDocumentManager
import com.intellij.util.concurrency.AppExecutorUtil
import dev.ponder.matching.MatchOutcome
import dev.ponder.matching.Origin
import dev.ponder.matching.PonderMatch
import dev.ponder.matching.PonderProblem
import dev.ponder.matching.PonderProblems
import dev.ponder.matching.PonderService
import dev.ponder.resolution.SymbolIdentity
import dev.ponder.settings.PonderConfigurable
import dev.ponder.settings.PonderSettings
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey
import dev.ponder.sources.newerPonderNeeded

/**
 * Shared by the shortcut, the context menu action and the gutter icon.
 *
 * 1. Resolution and every local source run in a background read action.
 * 2. If nothing local has an animation and the package (or standard-library module) is known, the online index is
 *    fetched in a cancellable background task (never in a read action, never on the UI thread). The very first
 *    time, the user is asked once.
 * 3. The popup opens on the UI thread. Every "nothing found" path ends in a [PonderProblem]: a short hint at the
 *    caret, and a notification that says what happened and what to try, with buttons for the fixes.
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
        val problem: PonderProblem,
        /** A declaration whose package could still have an animation online. */
        val remote: Remote?,
    )

    /** [localProblem] is what the library itself said (for example "its ponder.json is broken"), if anything. */
    private class Remote(val symbol: SymbolIdentity, val key: PackageKey, val offset: Int, val localProblem: PonderProblem?)

    /**
     * Opens the popup for the first offset that has an animation. When [explicit] (shortcut or menu) and nothing
     * matched, shows the problem.
     */
    fun activate(project: Project, editor: Editor, offsets: List<Int>, explicit: Boolean) {
        val psiManager = PsiDocumentManager.getInstance(project)
        psiManager.commitDocument(editor.document)

        ReadAction.nonBlocking<Result> {
            val file = psiManager.getPsiFile(editor.document) ?: return@nonBlocking Result(null, PonderProblems.unsupportedFile(), null)
            val service = project.service<PonderService>()
            var problem = PonderProblems.noName()
            var remote: Remote? = null
            for (offset in offsets) {
                val outcome = service.findAt(file, offset)
                if (outcome is MatchOutcome.Found) return@nonBlocking Result(outcome to offset, problem, null)
                if (outcome is MatchOutcome.NotFound) {
                    problem = outcome.problem ?: fallbackProblem(outcome)
                    val key = outcome.packageKey
                    val symbol = outcome.symbol
                    if (remote == null && key != null && symbol != null) remote = Remote(symbol, key, offset, outcome.problem)
                    if (outcome.reason != MatchOutcome.Reason.NOT_APPLICABLE) break // a real call; keep its problem
                }
            }
            Result(null, problem, remote)
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
                    explicit -> showProblem(project, editor, result.problem)
                }
            }
            .submit(AppExecutorUtil.getAppExecutorService())
    }

    /** For outcomes that carry no problem of their own (should not happen, but never show nothing). */
    private fun fallbackProblem(outcome: MatchOutcome.NotFound): PonderProblem {
        val name = outcome.symbol?.displayName ?: "this function"
        return when (outcome.reason) {
            MatchOutcome.Reason.NOT_APPLICABLE -> PonderProblems.noName()
            MatchOutcome.Reason.INVALID_METADATA -> PonderProblems.brokenLibraryFile("The library", outcome.detail ?: "it is not valid")
            MatchOutcome.Reason.LIBRARY_MISMATCH -> PonderProblems.libraryMismatch(outcome.detail ?: "")
            MatchOutcome.Reason.NO_METADATA, MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED ->
                PonderProblems.noAnimationYet(name, outcome.packageKey?.let { where(it) } ?: "this library")
        }
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

    /** `"numpy"` or `the Python standard library`. */
    private fun where(key: PackageKey): String =
        if (key.ecosystem == "std") "the ${key.label.substringBefore(" (")}" else "'${key.name}'"

    /** The library's own problem when it says more than "nothing here" (a broken file, a newer format). */
    private fun PonderProblem?.ifSpecific(): PonderProblem? = this?.takeIf { it.id in setOf("broken-library-file", "needs-update", "library-mismatch") }

    private fun tryOnline(project: Project, editor: Editor, remote: Remote) {
        val settings = service<PonderSettings>().state
        val index = service<OnlineIndex>()
        val base = settings.indexUrl.orEmpty()
        val name = remote.symbol.displayName

        when {
            settings.onlineLookup == PonderSettings.ONLINE_OFF ->
                showProblem(project, editor, remote.localProblem.ifSpecific() ?: PonderProblems.onlineOff(name, where(remote.key)))
            !index.needsFetch(base, remote.key) ->
                // checked recently and the cache had nothing for this function (a hit would have opened already)
                showProblem(project, editor, nothingFound(remote, index.cached(base, remote.key)), remote)
            settings.onlineLookup == PonderSettings.ONLINE_ASK -> askConsent(project, editor, remote)
            else -> fetchAndShow(project, editor, remote)
        }
    }

    private fun nothingFound(remote: Remote, lookup: OnlineIndex.Lookup?): PonderProblem {
        val name = remote.symbol.displayName
        if (lookup is OnlineIndex.Lookup.Failed) return PonderProblems.indexUnreachable(name, lookup.reason)
        lookup.newerPonderNeeded()?.let { return PonderProblems.needsUpdate(it) }
        return remote.localProblem.ifSpecific() ?: PonderProblems.noAnimationYet(name, where(remote.key))
    }

    private fun askConsent(project: Project, editor: Editor, remote: Remote) {
        val settingsService = service<PonderSettings>()
        if (settingsService.askedThisSession) {
            showProblem(project, editor, remote.localProblem.ifSpecific() ?: PonderProblems.onlineSkipped(remote.symbol.displayName))
            return
        }
        settingsService.askedThisSession = true
        hint(editor, "No animation on this computer. Ponder can look for one online (see the notification).")
        NotificationGroupManager.getInstance().getNotificationGroup("Ponder")
            .createNotification(
                "Look for Ponder animations online?",
                "When a function has no animation on this computer, Ponder can check the free community index. " +
                    "Only the library's name is sent (here: <b>${escape(remote.key.label)}</b>), never your code. " +
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
                if (f != null) open(project, editor, f, remote.offset) else showProblem(project, editor, nothingFound(remote, lookup), remote)
            }

            override fun onThrowable(error: Throwable) {
                log.warn("Ponder: online lookup failed", error)
                if (!editor.isDisposed) showProblem(project, editor, PonderProblems.indexUnreachable(remote.symbol.displayName, "something unexpected happened"), remote)
            }
        }.queue()
    }

    // ------------------------------------------------------------------ UI

    private fun open(project: Project, editor: Editor, found: MatchOutcome.Found, offset: Int) {
        val safeOffset = offset.coerceIn(0, editor.document.textLength) // the text may have changed meanwhile
        try {
            project.service<PonderPopupController>().open(editor, found.match, safeOffset)
        } catch (e: Exception) {
            log.warn("Ponder: could not open the popup", e)
            showProblem(project, editor, PonderProblems.unexpected())
        }
    }

    private fun hint(editor: Editor, text: String) {
        if (editor.isDisposed) return
        log.info("Ponder: $text")
        HintManager.getInstance().showInformationHint(editor, text)
    }

    /** The last problem notification, expired when the next one appears so they never pile up. */
    @Volatile private var lastNotification: Notification? = null

    /**
     * A short hint at the caret, and a notification with what happened, the steps to try and buttons for the
     * fixes. [remote] is needed for "Retry now".
     */
    private fun showProblem(project: Project, editor: Editor, problem: PonderProblem, remote: Remote? = null) {
        if (project.isDisposed) return
        log.info("Ponder: " + problem.longText)
        hint(editor, "Ponder: ${problem.title}")
        try {
            lastNotification?.expire()
            val n = NotificationGroupManager.getInstance().getNotificationGroup("Ponder")
                .createNotification(escape(problem.title), problemHtml(problem), if (problem.setup) NotificationType.WARNING else NotificationType.INFORMATION)
            for (a in problem.actions) {
                n.addAction(NotificationAction.createSimpleExpiring(a.label) { runAction(project, editor, a, remote) })
            }
            lastNotification = n
            n.notify(project)
        } catch (e: Exception) {
            log.warn("Ponder: could not show a notification", e)
        }
    }

    private fun escape(s: String) = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")

    /** Notification body: the explanation, then a numbered "Try" list. `code` in backticks becomes <code>. */
    internal fun problemHtml(problem: PonderProblem): String {
        fun rich(s: String) = escape(s).replace(Regex("`([^`]+)`"), "<code>$1</code>")
        return buildString {
            append(rich(problem.detail))
            append("<br><b>Try:</b><ol>")
            problem.tries.forEach { append("<li>").append(rich(it)).append("</li>") }
            append("</ol>")
        }
    }

    private fun runAction(project: Project, editor: Editor, action: PonderProblem.Action, remote: Remote?) {
        if (project.isDisposed) return
        try {
            when (action) {
                PonderProblem.Action.PROJECT_STRUCTURE -> runIdeAction("ShowProjectStructureSettings", editor)
                PonderProblem.Action.PYTHON_INTERPRETER -> ShowSettingsUtil.getInstance().showSettingsDialog(project, "Python Interpreter")
                PonderProblem.Action.PONDER_SETTINGS -> ShowSettingsUtil.getInstance().showSettingsDialog(project, PonderConfigurable::class.java)
                PonderProblem.Action.PLUGINS -> ShowSettingsUtil.getInstance().showSettingsDialog(project, "Plugins")
                PonderProblem.Action.DIAGNOSTICS -> runIdeAction("dev.ponder.ShowDiagnostics", editor)
                PonderProblem.Action.ENABLE_ONLINE -> {
                    service<PonderSettings>().state.onlineLookup = PonderSettings.ONLINE_ON
                    if (remote != null && !editor.isDisposed) fetchAndShow(project, editor, remote)
                    else hint(editor, "Ponder: online lookups are on. Press Alt+W on the function again.")
                }
                PonderProblem.Action.RETRY_ONLINE -> {
                    if (remote == null || editor.isDisposed) return
                    service<OnlineIndex>().forgetFailure(service<PonderSettings>().state.indexUrl.orEmpty(), remote.key)
                    fetchAndShow(project, editor, remote)
                }
            }
        } catch (e: Exception) {
            log.warn("Ponder: the action '${action.label}' failed", e)
            if (!editor.isDisposed) hint(editor, "Ponder: '${action.label}' is not available here.")
        }
    }

    private fun runIdeAction(id: String, editor: Editor) {
        val action = ActionManager.getInstance().getAction(id) ?: return
        ActionManager.getInstance().tryToExecute(action, null, editor.contentComponent, ActionPlaces.NOTIFICATION, true)
    }

}
