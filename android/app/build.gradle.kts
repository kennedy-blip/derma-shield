// DERMA-SHIELD · application module
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.dermashield.bio"
    compileSdk = rootProject.ext.get("compileSdkVersion") as Int

    defaultConfig {
        applicationId = "com.dermashield.bio"
        minSdk = rootProject.ext.get("minSdkVersion") as Int
        targetSdk = rootProject.ext.get("targetSdkVersion") as Int

        // Keep these in lockstep with the version/versionCode pair in
        // static/releases/release-manifest.json — the Download Centre renders
        // the manifest values next to the binary it serves.
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        // new DSL location for the legacy aaptOptions block; AGP 9 removes the old one.
        androidResources {
            ignoreAssetsPattern = "!.svn:!.git:!.ds_store:!*.scc:.*:!CVS:!thumbs.db:!picasa.ini:!*~"
        }
    }

    signingConfigs {
        /**
         * CI release signing identity.
         *
         * Checked into git on purpose: this app is self-distributed through its
         * own Download Centre, not through Google Play, so the only thing that
         * matters is that *every* CI build is signed by the *same* key —
         * otherwise Android refuses to upgrade an installed copy. The PKCS#12
         * bundle is long-lived (30 y), unencrypted-at-rest-equivalent (public
         * app, no Play upload key, no billing), and documented in
         * static/releases/README.md. Rotate it only with a versionCode bump and
         * a "uninstall previous build first" note.
         *
         * Override path/credentials with DS_KEYSTORE / DS_KEYSTORE_PASSWORD /
         * DS_KEY_ALIAS / DS_KEY_PASSWORD when a real upload key is available.
         */
        create("release") {
            storeFile = file(System.getenv("DS_KEYSTORE") ?: "dermashield-ci.p12")
            storePassword = System.getenv("DS_KEYSTORE_PASSWORD") ?: "dermashield"
            keyAlias = System.getenv("DS_KEY_ALIAS") ?: "dermashield"
            keyPassword = System.getenv("DS_KEY_PASSWORD") ?: "dermashield"
            storeType = "PKCS12"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Always signed, always with the same key: the checked-in CI identity
            // below, or an override injected through DS_KEYSTORE. Never unsigned —
            // Android refuses to install an unsigned APK, and a per-run debug key
            // would make each build un-upgradeable over the last.
            signingConfig = signingConfigs.getByName("release")
        }
    }

    // These MUST stay at 21: `capacitor.build.gradle` is applied at the bottom of
    // this file and sets the app module's compileOptions to Java 21. Kotlin 2.0
    // fails the build outright when compileDebugJavaWithJavac (21) and
    // compileDebugKotlin (17) disagree, so the JVM target is pinned to match.
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    kotlinOptions {
        jvmTarget = "21"
    }

    buildFeatures {
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("META-INF/NOTICE", "META-INF/LICENSE")
    }
}

repositories {
    google()
    mavenCentral()
}

apply(from = "capacitor.build.gradle")

dependencies {
    implementation("androidx.core:core-ktx:${rootProject.ext.get("androidxCoreVersion")}")
    implementation("androidx.appcompat:appcompat:${rootProject.ext.get("androidxAppCompatVersion")}")
    implementation("androidx.coordinatorlayout:coordinatorlayout:${rootProject.ext.get("androidxCoordinatorLayoutVersion")}")
    implementation("androidx.webkit:webkit:${rootProject.ext.get("androidxWebkitVersion")}")
    implementation("androidx.core:core-splashscreen:${rootProject.ext.get("coreSplashScreenVersion")}")
    implementation(project(":capacitor-android"))
    testImplementation("junit:junit:${rootProject.ext.get("junitVersion")}")
}
