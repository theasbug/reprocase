plugins { java }

group = "io.github.theasbug.reprocase"
version = "0.1.0"

repositories { mavenCentral() }

dependencies {
    compileOnly("net.portswigger.burp.extensions:montoya-api:2026.7")
}

java { toolchain { languageVersion.set(JavaLanguageVersion.of(17)) } }

tasks.jar {
    archiveFileName.set("reprocase-burp-${project.version}.jar")
}
