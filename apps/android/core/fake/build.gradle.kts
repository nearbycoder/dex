plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// FakeDex: an in-process stand-in for a Dex deployment (the agent's socket and RPC, media, the desktop page), for
// instrumented tests, screenshots, and the debug build's demo. Never part of a release build.
dependencies {
    api(project(":core:model"))
    api(libs.okhttp)
    api(libs.okhttp.mockwebserver)
    testImplementation(project(":core:client"))
    testImplementation(project(":core:openui"))
    testImplementation(libs.junit)
    testImplementation(libs.truth)
    testImplementation(libs.kotlinx.coroutines.test)
}
