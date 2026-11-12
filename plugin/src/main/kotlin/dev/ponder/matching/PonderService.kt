package dev.ponder.matching

import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiFile
import dev.ponder.diagnostics.PonderDiagnostics
import dev.ponder.diagnostics.Severity
import dev.ponder.discovery.LibraryCoordinatesDetector
import dev.ponder.discovery.LibraryEvidence
import dev.ponder.discovery.LibraryVerdict
import dev.ponder.format.AnimationInfo
import dev.ponder.format.PonderDocument
import dev.ponder.packages.PackageLayout
import dev.ponder.resolution.PonderResolver
import dev.ponder.resolution.Provenance
import dev.ponder.resolution.ResolvedSymbol
import dev.ponder.resolution.SymbolIdentity
import dev.ponder.settings.PonderSettings
import dev.ponder.sources.ExternalHit
import dev.ponder.sources.LocalFolders
import dev.ponder.sources.OnlineIndex
import dev.ponder.sources.PackageKey
import dev.ponder.sources.PackageKeys
import dev.ponder.sources.findAnimation

/** Where an animation came from. Shown to the user in the popup. */
enum class Origin { LIBRARY, LOCAL_FOLDER, ONLINE_INDEX }

class PonderMatch(
    val animation: AnimationInfo,
    val document: PonderDocument,
    val symbol: SymbolIdentity,
    val verdict: LibraryVerdict,
    /** Path of the ponder.json the animation came from, or the index URL. */
    val sourceDescription: String,
    val origin: Origin = Origin.LIBRARY,
    /** The package, for animations from a local folder or the online index. */
    val packageKey: PackageKey? = null,
) {
    /** One short line for the popup header. */
    val sourceLabel: String
        get() = when (origin) {
            Origin.LIBRARY -> "From the library"
            Origin.LOCAL_FOLDER, Origin.ONLINE_INDEX -> sourceDescription
        }
}

sealed interface MatchOutcome {
    data class Found(val match: PonderMatch) : MatchOutcome

    /**
     * [packageKey] is set when the declaration belongs to an identified package, i.e. when an online lookup could
     * still find an animation for it.
     */
    data class NotFound(
        val reason: Reason,
        val detail: String? = null,
        val packageKey: PackageKey? = null,
        /** The resolved declaration, when there was one (needed to match a fetched index without PSI). */
        val symbol: SymbolIdentity? = null,
        /** What the user sees when nothing better turns up (local folders, the online index). */
        val problem: PonderProblem? = null,
    ) : MatchOutcome

    enum class Reason {
        /** Nothing resolved, or the declaration is outside the project, its libraries and the standard library. */
        NOT_APPLICABLE,
        NO_METADATA,
        INVALID_METADATA,
        SYMBOL_NOT_DOCUMENTED,
        LIBRARY_MISMATCH,
    }
}

/**
 * Looks up the animation for one symbol, in this order:
 *
 *  1. the library's own ponder.json (declaration, its jar, module or package, library identity check, exact symbol);
 *  2. local folders (`.ponder/` in the project, and folders from the settings);
 *  3. the online index, from the cache only. Fetching happens outside read actions, see PonderActivation.
 *
 * Sources 2 and 3 only apply to identified packages (never to the user's own code), and only a file whose `library`
 * names that package can be used. Any failed step yields [MatchOutcome.NotFound].
 */
@Service(Service.Level.PROJECT)
class PonderService(private val project: Project) {

    /** Read action required. */
    fun findAt(file: PsiFile, offset: Int): MatchOutcome {
        val resolver = PonderResolver.forFile(file)
            ?: return PonderProblems.unsupportedFile().let { MatchOutcome.NotFound(MatchOutcome.Reason.NOT_APPLICABLE, it.title, problem = it) }
        val symbol = resolver.resolveAt(file, offset)
            ?: return resolver.explain(file, offset).let { MatchOutcome.NotFound(MatchOutcome.Reason.NOT_APPLICABLE, it.title, problem = it) }
        return evaluate(symbol)
    }

    fun evaluate(symbol: ResolvedSymbol): MatchOutcome = evaluate(symbol.identity)

    fun evaluate(identity: SymbolIdentity): MatchOutcome {
        val fromLibrary = evaluateLibrary(identity)
        if (fromLibrary !is MatchOutcome.NotFound) return fromLibrary
        if (fromLibrary.reason == MatchOutcome.Reason.NOT_APPLICABLE) return fromLibrary

        val key = PackageKeys.of(identity, project.service<PonderRegistry>(), project)
            ?: return fromLibrary.copy(problem = fromLibrary.problem ?: noKeyProblem(identity))
        external(identity, key)?.let { return it }
        return fromLibrary.copy(packageKey = key, symbol = identity)
    }

    /** Nothing can be looked up elsewhere: the user's own code, or a library Ponder cannot identify for sure. */
    private fun noKeyProblem(identity: SymbolIdentity): PonderProblem = when (val p = identity.provenance) {
        is Provenance.ProjectModule -> PonderProblems.ownCode(identity.displayName)
        is Provenance.Package ->
            if (PackageKeys.isOwnCode(project, p.root)) PonderProblems.ownCode(identity.displayName)
            else PonderProblems.unknownLibrary(identity.displayName, p.manifestName ?: p.root.name)
        is Provenance.Library -> PonderProblems.unknownLibrary(identity.displayName, libraryName(identity))
        is Provenance.StandardLibrary -> PonderProblems.noAnimationYet(identity.displayName, "the ${p.display}")
    }

    /** Local folders, then the online-index cache. No network. */
    private fun external(identity: SymbolIdentity, key: PackageKey): MatchOutcome.Found? {
        service<LocalFolders>().find(project, key, identity.candidates)?.let { return found(it, identity, key, Origin.LOCAL_FOLDER) }
        val settings = service<PonderSettings>().state
        if (settings.onlineLookup == PonderSettings.ONLINE_OFF) return null
        val cached = service<OnlineIndex>().cached(settings.indexUrl.orEmpty(), key) ?: return null
        return cached.findAnimation(key, identity.candidates)?.let { found(it, identity, key, Origin.ONLINE_INDEX) }
    }

    /** An animation from the online index after a fresh fetch (no PSI needed: the candidates are already known). */
    fun evaluateFetched(identity: SymbolIdentity, key: PackageKey, lookup: OnlineIndex.Lookup): MatchOutcome.Found? =
        lookup.findAnimation(key, identity.candidates)?.let { found(it, identity, key, Origin.ONLINE_INDEX) }

    private fun found(hit: ExternalHit, identity: SymbolIdentity, key: PackageKey, origin: Origin) =
        MatchOutcome.Found(PonderMatch(hit.animation, hit.document, identity, LibraryVerdict.Verified(key.evidence), hit.source, origin, key))

    private fun evaluateLibrary(identity: SymbolIdentity): MatchOutcome {
        val registry = project.service<PonderRegistry>()
        val loaded = registry.documentFor(identity.provenance)
            ?: return MatchOutcome.NotFound(
                MatchOutcome.Reason.NO_METADATA, noMetadataDetail(identity),
                problem = (identity.provenance as? Provenance.ProjectModule)?.let { PonderProblems.ownCode(identity.displayName) },
            )
        val document = loaded.document
            ?: return loaded.report.errors.firstOrNull()?.toString().let { first ->
                val library = libraryName(identity)
                val problem = if (loaded.report.needsUpdate) PonderProblems.needsUpdate(loaded.report.errors.firstOrNull()?.message ?: "This animation is meant for a newer Ponder.")
                else PonderProblems.brokenLibraryFile(library, first ?: "it is not valid")
                MatchOutcome.NotFound(MatchOutcome.Reason.INVALID_METADATA, first, problem = problem)
            }

        val animation = document.findAny(identity.candidates)
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED, identity.signature)

        val verdict: LibraryVerdict = when (val p = identity.provenance) {
            is Provenance.Library -> LibraryCoordinatesDetector.verify(document.library, registry.evidenceFor(p))
            // the file was found in the module that declares the symbol, so there is nothing else to check
            is Provenance.ProjectModule -> LibraryVerdict.Unverifiable
            is Provenance.Package -> verifyPackage(document, p)
            is Provenance.StandardLibrary -> LibraryVerdict.Verified(LibraryEvidence.Source.STANDARD_LIBRARY)
        }
        if (verdict is LibraryVerdict.Mismatch) {
            service<PonderDiagnostics>().record(Severity.WARNING, loaded.description, "Ignored: ${verdict.reason}")
            return MatchOutcome.NotFound(MatchOutcome.Reason.LIBRARY_MISMATCH, verdict.reason, problem = PonderProblems.libraryMismatch(verdict.reason))
        }
        return MatchOutcome.Found(PonderMatch(animation, document, identity, verdict, loaded.description))
    }

    private fun verifyPackage(document: PonderDocument, p: Provenance.Package): LibraryVerdict {
        val actual = p.manifestName ?: return LibraryVerdict.Unverifiable
        return if (PackageLayout.sameName(actual, document.library.name)) LibraryVerdict.Verified(LibraryEvidence.Source.PACKAGE_MANIFEST)
        else LibraryVerdict.Mismatch("ponder.json declares library ${document.library.name}, but the package is $actual.")
    }

    private fun libraryName(identity: SymbolIdentity): String = when (val p = identity.provenance) {
        is Provenance.Library -> p.libraryName?.substringAfter(": ")?.substringBeforeLast(':') ?: p.root.name
        is Provenance.ProjectModule -> p.module.name
        is Provenance.Package -> p.manifestName ?: p.root.name
        is Provenance.StandardLibrary -> "The ${p.display}"
    }

    private fun noMetadataDetail(identity: SymbolIdentity): String = when (val p = identity.provenance) {
        is Provenance.Library -> "${p.libraryName ?: p.root.name} has no META-INF/ponder/ponder.json"
        is Provenance.ProjectModule -> "${identity.displayName} is declared in this project (module ${p.module.name}), not in a library"
        is Provenance.Package -> "${p.manifestName ?: p.root.name} has no ponder.json (looked in ${p.root.presentableUrl})"
        is Provenance.StandardLibrary -> "${identity.displayName} is part of the ${p.display}"
    }
}
