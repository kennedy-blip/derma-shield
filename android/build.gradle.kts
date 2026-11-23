// DERMA-SHIELD · root Gradle build (Kotlin DSL)
//
// `variables.gradle` is the single source of truth for the SDK levels and the
// androidx versions. It MUST be applied here: `app/build.gradle.kts` and every
// Capacitor library module read their values from `rootProject.ext`, so without
// this line the build dies with "Cannot get property 'compileSdkVersion'".
//
// Kotlin is pinned to 2.0.21 to match `kotlin_version` in variables.gradle: the
// Capacitor library modules put the Kotlin Gradle plugin on their own buildscript
// classpath, and two different Kotlin plugin versions in one build is a hard
// failure. Keep the two numbers in lockstep.
plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}

apply(from = "variables.gradle")
