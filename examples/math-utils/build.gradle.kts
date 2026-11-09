plugins {
    `java-library`
}

group = "com.example"
version = "1.0.0"

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}
tasks.withType<JavaCompile> { options.release = 17 }

// Maven jars contain META-INF/maven/<group>/<artifact>/pom.properties and Ponder uses it to identify the
// library. Gradle does not write it, so add it here.
val pomProperties = tasks.register("pomProperties") {
    val out = layout.buildDirectory.file("generated/pom/META-INF/maven/${project.group}/math-utils/pom.properties")
    val g = project.group.toString(); val v = project.version.toString()
    outputs.file(out)
    doLast {
        out.get().asFile.apply { parentFile.mkdirs(); writeText("groupId=$g\nartifactId=math-utils\nversion=$v\n") }
    }
}
tasks.jar {
    dependsOn(pomProperties)
    from(layout.buildDirectory.dir("generated/pom"))
    archiveFileName = "math-utils-${project.version}.jar"
}

tasks.register<Copy>("syncDemoJar") {
    dependsOn(tasks.jar)
    from(tasks.jar)
    into(rootProject.layout.projectDirectory.dir("examples/consumer/libs"))
}
