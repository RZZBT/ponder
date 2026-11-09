import org.jetbrains.intellij.platform.gradle.TestFrameworkType
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm")
    id("org.jetbrains.intellij.platform")
}

group = "dev.ponder"
version = providers.gradleProperty("pluginVersion").get()

repositories {
    mavenCentral()
    intellijPlatform { defaultRepositories() }
}

val platformLocalPath = providers.gradleProperty("platformLocalPath").orNull?.takeIf { it.isNotBlank() }
val platformVersion = providers.gradleProperty("platformVersion").get()
val sinceBuildProp = providers.gradleProperty("platformSinceBuild").get()

dependencies {
    intellijPlatform {
        if (platformLocalPath != null) local(platformLocalPath) else intellijIdea(platformVersion)

        bundledPlugin("com.intellij.java")
        bundledPlugin("org.jetbrains.kotlin") // optional at runtime (see plugin.xml); needed to compile/test Kotlin support
        bundledPlugin("com.intellij.modules.jcef") // optional at runtime: without it Ponder shows the text fallback
        testBundledPlugin("JavaScript") // GenericResolverTest, MoreLanguagesTest
        testBundledPlugin("org.intellij.groovy") // MoreLanguagesTest

        testFramework(TestFrameworkType.Platform)
        testFramework(TestFrameworkType.Plugin.Java)
        pluginVerifier()
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.opentest4j:opentest4j:1.3.0")
}

kotlin {
    compilerOptions { jvmTarget = JvmTarget.JVM_25 }
}
java {
    sourceCompatibility = JavaVersion.VERSION_25
    targetCompatibility = JavaVersion.VERSION_25
}

intellijPlatform {
    pluginConfiguration {
        id = "dev.ponder"
        name = "Ponder"
        version = project.version.toString()
        description = """
            Interactive, animated documentation for library functions.
            Put the caret on a library call and press Alt+W to see a step-by-step animation written by the
            library's authors in <code>META-INF/ponder/ponder.json</code>. Animations are matched to the
            resolved method signature.
        """.trimIndent()
        ideaVersion {
            sinceBuild = sinceBuildProp
            untilBuild = provider { null }
        }
        vendor { name = "Ponder" }
    }
    pluginVerification {
        ides {
            // -PverifyIdes="C:/Program Files/JetBrains/PyCharm 2026.3;C:/Program Files/JetBrains/WebStorm 2026.3"
            val extra = providers.gradleProperty("verifyIdes").orNull?.split(';')?.map { it.trim() }?.filter { it.isNotEmpty() }.orEmpty()
            extra.forEach { local(it) }
            if (extra.isEmpty()) {
                if (platformLocalPath != null) local(platformLocalPath) else create(
                    org.jetbrains.intellij.platform.gradle.IntelliJPlatformType.IntellijIdea, platformVersion
                )
            }
        }
    }
}

// The engine is built with npm and packaged as resources.
val engineDir = rootProject.layout.projectDirectory.dir("engine")
val npm = if (System.getProperty("os.name").lowercase().contains("win")) "npm.cmd" else "npm"

val installEngine = tasks.register<Exec>("installEngine") {
    workingDir = engineDir.asFile
    commandLine(npm, "install", "--no-audit", "--no-fund")
    inputs.file(engineDir.file("package.json"))
    outputs.dir(engineDir.dir("node_modules"))
}

val buildEngine = tasks.register<Exec>("buildEngine") {
    dependsOn(installEngine)
    workingDir = engineDir.asFile
    commandLine(npm, "run", "build")
    inputs.dir(engineDir.dir("src"))
    inputs.file(engineDir.file("package.json"))
    inputs.file(engineDir.file("build.mjs"))
    outputs.dir(engineDir.dir("dist"))
}

tasks.processResources {
    dependsOn(buildEngine)
    from(engineDir.dir("dist")) {
        include("ponder-player.js", "ponder-player.css")
        into("ponder/web")
    }
    from(rootProject.layout.projectDirectory.dir("schema")) { include("ponder.schema.json"); into("ponder/schema") }
}

// runIde opens examples/consumer, a plain .iml project. Its JDK "ponder-demo-jdk" is registered in the sandbox
// and points at the JDK running Gradle.
val demoProject = rootProject.layout.projectDirectory.dir("examples/consumer").asFile
val demoJdkHome = File(System.getProperty("java.home"))
tasks.runIde {
    args = listOf(demoProject.absolutePath)
    doFirst {
        registerDemoJdk(sandboxConfigDirectory.get().file("options/jdk.table.xml").asFile, demoJdkHome)
        // drop cached project models from earlier runs
        sandboxSystemDirectory.get().dir("projects").asFile.listFiles { f -> f.name.startsWith("consumer.") }?.forEach { it.deleteRecursively() }
    }
}

// Any other installed JetBrains IDE with the plugin, e.g.
//   ./gradlew :plugin:runIdeWith "-PideDir=C:/Program Files/JetBrains/PyCharm 2026.3" -PdemoProject=examples/python
val otherIde = providers.gradleProperty("ideDir").orNull
val otherDemo = providers.gradleProperty("demoProject").orNull
intellijPlatformTesting {
    runIde {
        register("runIdeWith") {
            if (otherIde != null) localPath = file(otherIde)
            task {
                if (otherDemo != null) args = listOf(rootProject.file(otherDemo).absolutePath)
                jvmArgs("-Didea.trust.all.projects=true") // no trust dialog for the demo project
            }
        }
    }
}

// Python, Rust and C++ tests inside CLion (it bundles all three):
//   ./gradlew :plugin:testCLion "-PclionDir=C:/Program Files/JetBrains/CLion 2026.2.3.1"
val clionDir = providers.gradleProperty("clionDir").orNull
if (clionDir != null) {
    intellijPlatformTesting {
        testIde {
            register("testCLion") {
                localPath = file(clionDir)
                testFramework(TestFrameworkType.Platform)
                plugins {
                    bundledPlugin("PythonCore")
                    bundledPlugin("com.jetbrains.rust")
                    bundledPlugin("com.intellij.clion")
                }
                task {
                    useJUnit()
                    jvmArgs("-Xmx1500m")
                    isScanForTestClasses = false
                    include("dev/ponder/otheride/*Test.class")
                }
            }
        }
    }
}

/** Adds a JDK named "ponder-demo-jdk" to the sandbox's jdk.table.xml unless it is already there. */
fun registerDemoJdk(table: File, home: File) {
    val name = "ponder-demo-jdk"
    val text = if (table.isFile) table.readText() else ""
    if (text.contains("<name value=\"$name\" />")) return
    val java = File(home, "bin/" + if (System.getProperty("os.name").lowercase().contains("win")) "java.exe" else "java")
    val modules = ProcessBuilder(java.path, "--list-modules").redirectErrorStream(true).start()
        .inputStream.bufferedReader().readLines().map { it.substringBefore('@').trim() }.filter { it.matches(Regex("[\\w.]+")) }
    val homePath = home.absolutePath.replace('\\', '/')
    val roots = modules.joinToString("\n") { "            <root url=\"jrt://$homePath!/$it\" type=\"simple\" />" }
    val jdk = """    <jdk version="2">
      <name value="$name" />
      <type value="JavaSDK" />
      <version value="${System.getProperty("java.version")}" />
      <homePath value="$homePath" />
      <roots>
        <annotationsPath><root type="composite" /></annotationsPath>
        <classPath>
          <root type="composite">
$roots
          </root>
        </classPath>
        <javadocPath><root type="composite" /></javadocPath>
        <sourcePath><root type="composite" /></sourcePath>
      </roots>
      <additional />
    </jdk>"""
    val out = if (text.contains("<component name=\"ProjectJdkTable\">") && text.contains("</component>"))
        text.replaceFirst("</component>", "$jdk\n  </component>")
    else "<application>\n  <component name=\"ProjectJdkTable\">\n$jdk\n  </component>\n</application>\n"
    table.parentFile.mkdirs()
    table.writeText(out)
    logger.lifecycle("Registered sandbox JDK '$name' -> $homePath (${modules.size} modules)")
}

tasks.test {
    useJUnit()
    exclude("dev/ponder/otheride/**") // needs CLion, see testCLion
    jvmArgs("-Xmx1g")
    systemProperty("ponder.repoRoot", rootProject.projectDir.absolutePath)
    systemProperty("ponder.jdkHome", System.getProperty("java.home")) // its javac builds the test fixture jars
}
