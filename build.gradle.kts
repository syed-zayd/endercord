// Shared configuration for the EnderCord Minecraft plugin.
// Project-specific dependencies and jar naming live in endercord-plugin/build.gradle.kts.
plugins {
    java
    id("com.gradleup.shadow") version "9.4.2" apply false
}

subprojects {
    apply(plugin = "java")
    apply(plugin = "com.gradleup.shadow")

    group = "com.zaydsyed"

    repositories {
        mavenCentral()
        // Paper API
        maven("https://repo.papermc.io/repository/maven-public/")
    }

    dependencies {
        // Paper API — provided by the server at runtime, so compile-only.
        // Also transitively provides Gson and the log4j API.
        "compileOnly"("io.papermc.paper:paper-api:26.1.2.build.70-stable")
    }

    java {
        toolchain {
            // Paper 26.1 requires Java 25. Gradle auto-downloads it (foojay) if missing.
            languageVersion = JavaLanguageVersion.of(25)
        }
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
    }

    // `./gradlew build` produces the deployable shaded jar.
    tasks.named("build") {
        dependsOn("shadowJar")
    }

    // Don't emit the redundant thin jar (no bundled deps) — only the shaded jar.
    tasks.named<Jar>("jar") {
        enabled = false
    }
}
