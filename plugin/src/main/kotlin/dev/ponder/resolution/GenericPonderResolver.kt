package dev.ponder.resolution

import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiFileSystemItem
import com.intellij.psi.PsiNameIdentifierOwner
import com.intellij.psi.PsiNamedElement
import com.intellij.psi.PsiPolyVariantReference
import com.intellij.psi.PsiReference
import com.intellij.psi.util.PsiTreeUtil
import dev.ponder.matching.PonderProblem
import dev.ponder.matching.PonderProblems
import dev.ponder.packages.PackageLayout
import dev.ponder.sources.StdLibrary

/**
 * Any language whose IDE support resolves references (PyCharm, WebStorm, GoLand, RustRover, RubyMine, PhpStorm,
 * CLion, ...). The declaration's file decides the package (see [PackageLayout]); the symbol is built from the
 * file path inside the package and the declaration's enclosing names.
 */
class GenericPonderResolver : PonderResolver {
    override fun handles(file: PsiFile): Boolean = true

    override fun resolveAt(file: PsiFile, offset: Int): ResolvedSymbol? {
        for (o in offsets(file, offset)) {
            val ref = file.findReferenceAt(o) ?: continue
            val target = resolveSingle(ref) ?: continue
            val useSite = file.findElementAt(o) ?: continue
            return symbolFor(target, useSite)
        }
        return null
    }

    override fun explain(file: PsiFile, offset: Int): PonderProblem {
        for (o in offsets(file, offset)) {
            val ref = file.findReferenceAt(o) ?: continue
            val name = ref.canonicalText.substringAfterLast('.').take(40)
            if (resolveSingle(ref) == null) return PonderProblems.cannotResolve(name, file.language.id.lowercase())
            // resolves, but to a module, a folder or something without a name path: not a function Ponder can explain
            return PonderProblems.notAFunction(name)
        }
        return PonderProblems.noName()
    }

    override fun authoringSymbol(file: PsiFile, offset: Int): String? {
        resolveAt(file, offset)?.let { return it.identity.signature }
        val leaf = file.findElementAt(offset) ?: return null
        val owner = PsiTreeUtil.getParentOfType(leaf, PsiNameIdentifierOwner::class.java, false)
            ?.takeIf { it.nameIdentifier?.textRange?.contains(leaf.textRange) == true } ?: return null
        return symbolFor(owner, leaf)?.identity?.signature
    }

    private fun offsets(file: PsiFile, offset: Int) = intArrayOf(offset, offset - 1).filter { it in 0 until file.textLength }

    private fun resolveSingle(ref: PsiReference): PsiElement? {
        ref.resolve()?.let { return it }
        val results = (ref as? PsiPolyVariantReference)?.multiResolve(false) ?: return null
        return results.mapNotNull { it.element }.distinct().singleOrNull()
    }

    internal fun symbolFor(declaration: PsiElement, useSite: PsiElement): ResolvedSymbol? {
        val target = declaration.navigationElement ?: declaration
        if (target is PsiFileSystemItem) return null
        val file: VirtualFile = target.containingFile?.virtualFile ?: return null
        val folder = file.parent ?: return null
        val names = enclosingNames(target)
        if (names.isEmpty()) return null

        // the language's standard library (typeshed stubs, CPython sources, Rust's toolchain, GOROOT)
        StdLibrary.recognize(file.path, names)?.let { std ->
            val version = std.version ?: goVersion(std)
            val identity = SymbolIdentity(
                language = target.language.id,
                provenance = Provenance.StandardLibrary(std.language, std.module, version),
                signature = std.candidates.first(),
                alternatives = std.candidates.drop(1),
                displayName = names.last(),
            )
            return ResolvedSymbol(identity, useSite)
        }

        val root = PackageLayout.findRoot(VfsDir(folder))
        val rootDir = (root.dir as VfsDir).file
        val rel = VfsUtilCore.getRelativePath(file, rootDir, '/') ?: return null
        val candidates = PackageLayout.candidates(root, rel, names)
        val provenance = Provenance.Package(rootDir, root.ponderFile, PackageLayout.manifestName(root))
        // the language scheme (py:, js:, ...) is the main symbol when there is one; sym: always works
        val main = candidates.firstOrNull { !it.startsWith("sym:") } ?: candidates.first()
        val identity = SymbolIdentity(
            language = target.language.id,
            provenance = provenance,
            signature = main,
            alternatives = candidates - main,
            displayName = names.last(),
        )
        return ResolvedSymbol(identity, useSite)
    }

    /**
     * `["IntStack", "push"]` for a method push in class IntStack. Unnamed containers that still name a type are
     * read from their text, so the result equals what VS Code language servers report in their outlines:
     * Rust `impl IntStack { fn push }` and Go `func (s *IntStack) Push()`.
     */
    private fun enclosingNames(target: PsiElement): List<String> {
        val out = ArrayList<String>()
        var e: PsiElement? = target
        while (e != null && e !is PsiFile) {
            val named = (e as? PsiNamedElement)?.name?.takeIf { it.isNotBlank() && !it.contains(Regex("\\s")) }
            if (named != null) {
                out += named
                if (e === target) PackageLayout.goReceiver(e.text.take(200))?.let { out += it }
            } else if (e !== target) {
                PackageLayout.implType(e.text.take(200))?.let { out += it }
            }
            e = e.parent
        }
        return out.reversed().distinctConsecutive()
    }

    private fun List<String>.distinctConsecutive(): List<String> = filterIndexed { i, s -> i == 0 || this[i - 1] != s }

    /** GOROOT/VERSION (`go1.22.3`) when the path itself does not tell the Go version. */
    private fun goVersion(std: StdLibrary.Declaration): String? {
        if (std.language != "go" || std.root.isEmpty()) return null
        return runCatching {
            val f = LocalFileSystem.getInstance().findFileByPath("${std.root}/VERSION")?.takeIf { !it.isDirectory && it.length < 4096 }
            f?.let { StdLibrary.goVersionFromFile(String(it.contentsToByteArray(), Charsets.UTF_8)) }
        }.getOrNull()
    }
}

/** [PackageLayout.Dir] over the IDE's virtual file system (also works inside archives). */
class VfsDir(val file: VirtualFile) : PackageLayout.Dir {
    override val name: String get() = file.name
    override val parent: PackageLayout.Dir? get() = file.parent?.let { VfsDir(it) }
    override fun hasFile(name: String): Boolean = file.findFileByRelativePath(name)?.isDirectory == false
    override fun hasFileMatching(suffix: String): Boolean = file.children.any { !it.isDirectory && it.name.endsWith(suffix) }
    override fun readText(name: String): String? {
        val f = file.findFileByRelativePath(name)?.takeIf { !it.isDirectory && it.length < 256 * 1024 } ?: return null
        return runCatching { String(f.contentsToByteArray(), Charsets.UTF_8) }.getOrNull()
    }
}
