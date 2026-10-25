dependencies {
    // log4j-core is provided by Paper at runtime (used to capture /exec console output).
    compileOnly("org.apache.logging.log4j:log4j-core:2.25.2")

    // SQLite JDBC is NOT on the server classpath — bundle it into the jar.
    implementation("org.xerial:sqlite-jdbc:3.53.2.0")
}

tasks.shadowJar {
    // Produce exactly "Endercord.jar" (no version/classifier suffix) for deployment.
    archiveFileName.set("Endercord.jar")
}
