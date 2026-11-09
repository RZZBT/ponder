package dev.ponder.discovery

import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.vfs.VirtualFile
import dev.ponder.packages.PackageLayout
import dev.ponder.resolution.Provenance

/** Finds the ponder.json of a declaration's jar root, module or package. Only that one container is searched. */
object PonderDiscovery {
    const val RESOURCE_PATH = PackageLayout.PONDER_RESOURCE
    private const val MODULE_ROOT_FILE = PackageLayout.PONDER_FILE

    fun locate(provenance: Provenance): VirtualFile? = when (provenance) {
        is Provenance.Library -> provenance.root.takeIf { it.isValid }?.findFileByRelativePath(RESOURCE_PATH)?.takeIf { !it.isDirectory }
        is Provenance.ProjectModule -> locateInModule(provenance)
        is Provenance.Package -> provenance.ponderPath
            ?.let { provenance.root.takeIf { r -> r.isValid }?.findFileByRelativePath(it) }
            ?.takeIf { !it.isDirectory }
    }

    /** First-party code: `META-INF/ponder/ponder.json` under a source/resource root, else `ponder.json` in a content root. */
    private fun locateInModule(p: Provenance.ProjectModule): VirtualFile? {
        val module = p.module.takeIf { !it.isDisposed } ?: return null
        val rm = ModuleRootManager.getInstance(module)
        for (root in rm.sourceRoots) {
            root.findFileByRelativePath(RESOURCE_PATH)?.takeIf { !it.isDirectory }?.let { return it }
        }
        for (root in rm.contentRoots) {
            root.findFileByRelativePath(RESOURCE_PATH)?.takeIf { !it.isDirectory }?.let { return it }
            root.findChild(MODULE_ROOT_FILE)?.takeIf { !it.isDirectory }?.let { return it }
        }
        return null
    }
}
