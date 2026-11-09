rootProject.name = "ponder"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

include(":plugin", ":examples:math-utils")
// examples/consumer is a standalone project opened by runIde, not part of this build.
