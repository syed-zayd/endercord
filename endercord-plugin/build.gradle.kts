dependencies {
    // log4j-core is provided by Paper at runtime (used to capture /exec console output).
    compileOnly("org.apache.logging.log4j:log4j-core:2.25.2")

    // SQLite JDBC is NOT on the server classpath — bundle it into the jar.
    implementation("org.xerial:sqlite-jdbc:3.53.2.0")
    testImplementation("io.papermc.paper:paper-api:26.1.2.build.70-stable")
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    testRuntimeOnly("org.apache.logging.log4j:log4j-core:2.25.2")
    testImplementation("org.mockito:mockito-core:5.23.0")
}

tasks.test { useJUnitPlatform() }

tasks.shadowJar {
    // Produce exactly "Endercord.jar" (no version/classifier suffix) for deployment.
    archiveFileName.set("Endercord.jar")
}
