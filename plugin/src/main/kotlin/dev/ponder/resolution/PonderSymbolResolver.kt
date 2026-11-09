package dev.ponder.resolution

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.LibraryOrderEntry
import com.intellij.openapi.roots.OrderRootType
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiArrayType
import com.intellij.psi.PsiClass
import com.intellij.psi.PsiClassType
import com.intellij.psi.PsiComment
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiEllipsisType
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiIdentifier
import com.intellij.psi.PsiJavaCodeReferenceElement
import com.intellij.psi.PsiMethod
import com.intellij.psi.PsiMethodReferenceExpression
import com.intellij.psi.PsiNewExpression
import com.intellij.psi.PsiPrimitiveType
import com.intellij.psi.PsiReferenceExpression
import com.intellij.psi.PsiType
import com.intellij.psi.PsiTypeParameter
import com.intellij.psi.PsiWhiteSpace
import com.intellij.psi.util.ClassUtil
import com.intellij.psi.util.TypeConversionUtil
import org.jetbrains.uast.UCallExpression
import org.jetbrains.uast.UCallableReferenceExpression
import org.jetbrains.uast.UIdentifier
import org.jetbrains.uast.UMethod
import org.jetbrains.uast.UResolvable
import org.jetbrains.uast.getUParentForIdentifier
import org.jetbrains.uast.toUElementOfType

/**
 * JVM symbols for Java (PSI) and Kotlin and other UAST languages. Returns null when the reference does not
 * resolve to exactly one method. All functions need a read action.
 */
object PonderSymbolResolver {

    /** Also tries the character before [offset], so a caret at `clamp|(` still works. */
    fun resolveAt(file: PsiFile, offset: Int): ResolvedSymbol? {
        assertReadAccess()
        for (leaf in leavesAt(file, offset)) resolveIdentifier(leaf)?.let { return it }
        return null
    }

    /** The method at [offset], whether the caret is on a call to it or on its declaration. */
    fun methodForAuthoring(file: PsiFile, offset: Int): PsiMethod? {
        assertReadAccess()
        for (leaf in leavesAt(file, offset)) {
            targetMethod(leaf)?.let { return it }
            val parent = leaf.parent
            if (parent is PsiMethod && parent.nameIdentifier == leaf) return parent
            (getUParentForIdentifier(leaf) as? UMethod)?.let { return it.javaPsi }
        }
        return null
    }

    /** e.g. `com.example.math.MathUtils#clamp(int,int,int)` */
    fun symbolString(method: PsiMethod): String? {
        val cls = method.containingClass?.qualifiedName ?: return null
        val member = if (method.isConstructor) "<init>" else method.name
        return "$cls#$member(${method.parameterList.parameters.joinToString(",") { erasedName(it.type) }})"
    }

    /** Why [resolveAt] found nothing, in words a user can act on. */
    fun explain(file: PsiFile, offset: Int): String {
        assertReadAccess()
        val noJdk = ProjectRootManager.getInstance(file.project).projectSdk == null
        val reason = leavesAt(file, offset).firstNotNullOfOrNull { explainLeaf(it) } ?: "the caret is not on a method name"
        return if (noJdk) "$reason (the project has no JDK set)" else reason
    }

    private fun explainLeaf(leaf: PsiElement): String? {
        if (leaf is PsiWhiteSpace || leaf is PsiComment) return null
        val ref = leaf.parent as? PsiReferenceExpression ?: return null
        if (leaf !is PsiIdentifier) return null
        val name = leaf.text
        val result = ref.advancedResolve(false)
        val method = result.element as? PsiMethod
        return when {
            result.element == null -> "cannot resolve '$name'; is its library on the classpath?"
            method == null -> null
            !result.isValidResult -> "the call to '$name' has errors; check its arguments"
            else -> "'$name' is declared outside this project's libraries"
        }
    }

    fun resolveIdentifier(leaf: PsiElement): ResolvedSymbol? {
        assertReadAccess()
        val method = targetMethod(leaf) ?: return null
        return symbolFor(leaf.project, method, leaf)
    }

    private fun leavesAt(file: PsiFile, offset: Int): List<PsiElement> =
        intArrayOf(offset, offset - 1).filter { it in 0..file.textLength }.mapNotNull { file.findElementAt(it) }

    internal fun targetMethod(leaf: PsiElement): PsiMethod? {
        val parent = leaf.parent
        if (leaf is PsiIdentifier) {
            when (parent) {
                is PsiMethodReferenceExpression -> return parent.validMethod()
                is PsiReferenceExpression -> return parent.validMethod()
                is PsiJavaCodeReferenceElement -> {
                    val grand = parent.parent
                    if (grand is PsiNewExpression && grand.classReference == parent) {
                        return grand.resolveMethodGenerics().takeIf { it.isValidResult }?.element as? PsiMethod
                    }
                }
            }
            return null
        }
        // Kotlin, Groovy, ...: only when the leaf is the callee identifier of a call or reference
        val owner = getUParentForIdentifier(leaf) ?: leaf.toUElementOfType<UIdentifier>()?.uastParent ?: return null
        return when (owner) {
            is UCallExpression ->
                if (owner.methodIdentifier?.sourcePsi == leaf || owner.classReference?.sourcePsi == leaf) owner.resolve() else null
            is UCallableReferenceExpression -> owner.resolve() as? PsiMethod
            is UResolvable -> owner.resolve() as? PsiMethod
            else -> null
        }
    }

    // An erroneous call must not bind to the resolver's best guess.
    private fun PsiReferenceExpression.validMethod(): PsiMethod? {
        val r = advancedResolve(false)
        return if (r.isValidResult) r.element as? PsiMethod else null
    }

    private fun PsiMethodReferenceExpression.validMethod(): PsiMethod? {
        val r = advancedResolve(false)
        return if (r.isValidResult) r.element as? PsiMethod else null
    }

    internal fun symbolFor(project: Project, method: PsiMethod, useSite: PsiElement): ResolvedSymbol? {
        val cls = method.containingClass ?: return null
        val declaringName = cls.qualifiedName ?: return null // anonymous and local classes
        val provenance = provenanceOf(project, method, cls) ?: return null
        val member = if (method.isConstructor) "<init>" else method.name
        val params = method.parameterList.parameters.joinToString(",") { erasedName(it.type) }
        val identity = SymbolIdentity(
            language = method.language.id,
            provenance = provenance,
            signature = "$declaringName#$member($params)",
            displayName = if (method.isConstructor) cls.name ?: member else method.name,
            declaringClass = declaringName,
        )
        return ResolvedSymbol(identity, useSite)
    }

    /** JVM erasure (JLS 4.6): type variables become their first bound, generic types their raw class, varargs arrays. */
    internal fun erasedName(type: PsiType, depth: Int = 0): String {
        if (depth > 16) return "java.lang.Object"
        return when (type) {
            is PsiEllipsisType -> erasedName(type.componentType, depth + 1) + "[]"
            is PsiArrayType -> erasedName(type.componentType, depth + 1) + "[]"
            is PsiPrimitiveType -> type.canonicalText
            is PsiClassType -> {
                when (val cls = type.resolve()) {
                    is PsiTypeParameter -> cls.extendsListTypes.firstOrNull()?.let { erasedName(it, depth + 1) } ?: "java.lang.Object"
                    null -> type.rawType().canonicalText
                    else -> cls.qualifiedName ?: type.rawType().canonicalText
                }
            }
            else -> TypeConversionUtil.erasure(type)?.canonicalText ?: type.canonicalText
        }
    }

    internal fun provenanceOf(project: Project, method: PsiMethod, cls: PsiClass): Provenance? {
        val vf: VirtualFile = method.containingFile?.virtualFile ?: return null
        val index = ProjectFileIndex.getInstance(project)

        if (index.isInLibraryClasses(vf)) {
            val entry = index.getOrderEntriesForFile(vf).filterIsInstance<LibraryOrderEntry>().firstOrNull() ?: return null // JDK
            val root = index.getClassRootForFile(vf) ?: return null
            return Provenance.Library(root.url, root, entry.libraryName ?: entry.library?.name)
        }
        if (index.isInLibrarySource(vf)) {
            // attached sources jar: ponder.json lives in the classes root that holds the compiled class
            val entry = index.getOrderEntriesForFile(vf).filterIsInstance<LibraryOrderEntry>().firstOrNull() ?: return null
            val binary = ClassUtil.getJVMClassName(cls)?.replace('.', '/') ?: return null
            val root = entry.library?.getFiles(OrderRootType.CLASSES)
                ?.firstOrNull { it.findFileByRelativePath("$binary.class") != null } ?: return null
            return Provenance.Library(root.url, root, entry.libraryName ?: entry.library?.name)
        }
        if (index.isInSourceContent(vf)) {
            val module = index.getModuleForFile(vf) ?: return null
            return Provenance.ProjectModule(module)
        }
        return null
    }

    private fun assertReadAccess() {
        ApplicationManager.getApplication().assertReadAccessAllowed()
    }
}
