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

class PonderMatch(
    val animation: AnimationInfo,
    val document: PonderDocument,
    val symbol: SymbolIdentity,
    val verdict: LibraryVerdict,
    /** Path of the ponder.json the animation came from. */
    val sourceDescription: String,
)

sealed interface MatchOutcome {
    data class Found(val match: PonderMatch) : MatchOutcome

    data class NotFound(val reason: Reason, val detail: String? = null) : MatchOutcome

    enum class Reason {
        /** Nothing resolved, or the declaration is outside the project and its libraries (e.g. the JDK). */
        NOT_APPLICABLE,
        NO_METADATA,
        INVALID_METADATA,
        SYMBOL_NOT_DOCUMENTED,
        LIBRARY_MISMATCH,
    }
}

/**
 * Looks up the animation for one symbol: declaration, its jar, module or package, that container's ponder.json,
 * library identity check, exact symbol match. Any failed step yields [MatchOutcome.NotFound].
 */
@Service(Service.Level.PROJECT)
class PonderService(private val project: Project) {

    /** Read action required. */
    fun findAt(file: PsiFile, offset: Int): MatchOutcome {
        val resolver = PonderResolver.forFile(file)
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.NOT_APPLICABLE, "this file type is not supported")
        val symbol = resolver.resolveAt(file, offset)
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.NOT_APPLICABLE, resolver.explain(file, offset))
        return evaluate(symbol)
    }

    fun evaluate(symbol: ResolvedSymbol): MatchOutcome = evaluate(symbol.identity)

    fun evaluate(identity: SymbolIdentity): MatchOutcome {
        val registry = project.service<PonderRegistry>()
        val loaded = registry.documentFor(identity.provenance)
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.NO_METADATA, noMetadataDetail(identity))
        val document = loaded.document
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.INVALID_METADATA, loaded.report.errors.firstOrNull()?.toString())

        val animation = document.findAny(identity.candidates)
            ?: return MatchOutcome.NotFound(MatchOutcome.Reason.SYMBOL_NOT_DOCUMENTED, identity.signature)

        val verdict: LibraryVerdict = when (val p = identity.provenance) {
            is Provenance.Library -> LibraryCoordinatesDetector.verify(document.library, registry.evidenceFor(p))
            // the file was found in the module that declares the symbol, so there is nothing else to check
            is Provenance.ProjectModule -> LibraryVerdict.Unverifiable
            is Provenance.Package -> verifyPackage(document, p)
        }
        if (verdict is LibraryVerdict.Mismatch) {
            service<PonderDiagnostics>().record(Severity.WARNING, loaded.description, "Ignored: ${verdict.reason}")
            return MatchOutcome.NotFound(MatchOutcome.Reason.LIBRARY_MISMATCH, verdict.reason)
        }
        return MatchOutcome.Found(PonderMatch(animation, document, identity, verdict, loaded.description))
    }

    private fun verifyPackage(document: PonderDocument, p: Provenance.Package): LibraryVerdict {
        val actual = p.manifestName ?: return LibraryVerdict.Unverifiable
        return if (PackageLayout.sameName(actual, document.library.name)) LibraryVerdict.Verified(LibraryEvidence.Source.PACKAGE_MANIFEST)
        else LibraryVerdict.Mismatch("ponder.json declares library ${document.library.name}, but the package is $actual.")
    }

    private fun noMetadataDetail(identity: SymbolIdentity): String = when (val p = identity.provenance) {
        is Provenance.Library -> "${p.libraryName ?: p.root.name} has no META-INF/ponder/ponder.json"
        is Provenance.ProjectModule -> "${identity.displayName} is declared in this project (module ${p.module.name}), not in a library"
        is Provenance.Package -> "${p.manifestName ?: p.root.name} has no ponder.json (looked in ${p.root.presentableUrl})"
    }
}
