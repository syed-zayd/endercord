// Auto-provisions the required JDK (Java 25) if it isn't installed locally,
// so a plain `./gradlew build` works without a manual JDK install.
plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "endercord"

// The Cloudflare Worker (endercord-workers) is a separate npm project and is
// intentionally NOT a Gradle module. PingGuard is maintained separately.
include("endercord-plugin")
