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

dependencies {
    api(libs.kotlinx.serialization.json)
    api(libs.kotlinx.coroutines.core)
    testImplementation(libs.junit)
    testImplementation(libs.truth)
    testImplementation(libs.kotlinx.coroutines.test)
}

// The component spec the agent teaches the model (apps/web/src/shared/openui-spec.json) is the one the app parses with:
// copied in at build time, never duplicated in the repo.
val syncOpenUiSpec by tasks.registering(Sync::class) {
    from(rootProject.layout.projectDirectory.file("../web/src/shared/openui-spec.json"))
    into(layout.buildDirectory.dir("generated/openui-spec/dev/trydex/openui"))
}

sourceSets.main {
    resources.srcDir(layout.buildDirectory.dir("generated/openui-spec"))
}

tasks.named("processResources") { dependsOn(syncOpenUiSpec) }
