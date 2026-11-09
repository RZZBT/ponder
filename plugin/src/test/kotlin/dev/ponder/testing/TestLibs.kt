package dev.ponder.testing

import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import java.util.jar.JarEntry
import java.util.jar.JarOutputStream

/** Builds library jars (compiled classes and resources) at test time, so resolution runs against bytecode. */
object TestLibs {

    /** Minimal valid ponder.json: one circle moving across two slides. */
    fun ponderJson(
        group: String,
        name: String,
        vararg animations: Triple<String, String, String>, // id, symbol, title
        extraAnimationJson: String = "",
    ): String {
        val anims = animations.joinToString(",\n") { (id, symbol, title) ->
            """"$id": {
              "symbol": "$symbol", "title": "$title",
              "actors": { "dot": { "type": "circle", "x": 10, "y": 100, "radius": 12 } },
              "slides": [ { "id": "a", "caption": "start" }, { "id": "b", "caption": "end", "changes": { "dot": { "x": 400 } } } ]
            }"""
        }
        return """{ "version": 1, "library": { "group": "$group", "name": "$name" }, "animations": { $anims${if (extraAnimationJson.isNotEmpty()) ",$extraAnimationJson" else ""} } }"""
    }

    /**
     * Compiles [sources] (path like `com/example/Foo.java` -> source) and packs classes + [resources] into a jar.
     * [pom] adds META-INF/maven/<g>/<a>/pom.properties like a Maven build does.
     */
    fun buildJar(
        dir: Path,
        fileName: String,
        sources: Map<String, String>,
        resources: Map<String, String> = emptyMap(),
        pom: Triple<String, String, String>? = null,
    ): Path {
        val classes = compile(sources)
        val jar = dir.resolve(fileName)
        Files.createDirectories(dir)
        JarOutputStream(Files.newOutputStream(jar)).use { out ->
            fun put(path: String, bytes: ByteArray) {
                out.putNextEntry(JarEntry(path)); out.write(bytes); out.closeEntry()
            }
            classes.forEach { (name, bytes) -> put(name.replace('.', '/') + ".class", bytes) }
            resources.forEach { (path, text) -> put(path, text.toByteArray(Charsets.UTF_8)) }
            if (pom != null) {
                put("META-INF/maven/${pom.first}/${pom.second}/pom.properties", "groupId=${pom.first}\nartifactId=${pom.second}\nversion=${pom.third}\n".toByteArray())
            }
        }
        return jar
    }

    /**
     * Compiles with a forked javac from the JDK running Gradle (the IDE test runtime has no in-process compiler).
     * Returns binary class name -> bytes.
     */
    private fun compile(sources: Map<String, String>): Map<String, ByteArray> {
        val jdkHome = System.getProperty("ponder.jdkHome") ?: error("ponder.jdkHome not set (configured by plugin/build.gradle.kts)")
        val exe = File(jdkHome, "bin/" + if (System.getProperty("os.name").lowercase().contains("win")) "javac.exe" else "javac")
        check(exe.isFile) { "javac not found at $exe" }
        val work = Files.createTempDirectory("ponder-javac")
        try {
            val src = work.resolve("src"); val out = work.resolve("out")
            Files.createDirectories(out)
            val files = sources.map { (path, code) ->
                src.resolve(path).also { Files.createDirectories(it.parent); Files.writeString(it, code) }.toString()
            }
            val cmd = listOf(exe.path, "--release", "17", "-parameters", "-nowarn", "-d", out.toString()) + files
            val proc = ProcessBuilder(cmd).redirectErrorStream(true).start()
            val log = proc.inputStream.readBytes().toString(Charsets.UTF_8)
            check(proc.waitFor() == 0) { "Test library failed to compile:\n$log" }
            val result = LinkedHashMap<String, ByteArray>()
            Files.walk(out).use { stream ->
                stream.filter { it.toString().endsWith(".class") }.forEach {
                    result[out.relativize(it).toString().removeSuffix(".class").replace(File.separatorChar, '.')] = Files.readAllBytes(it)
                }
            }
            return result
        } finally {
            work.toFile().deleteRecursively()
        }
    }

    fun tempDir(prefix: String): Path = Files.createTempDirectory(prefix).also { it.toFile().deleteOnExit() }

    fun copyFile(from: File, toDir: Path): Path = Files.copy(from.toPath(), toDir.resolve(from.name))
}
