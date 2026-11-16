pluginManagement {
  repositories {
    google {
      content {
        includeGroupByRegex("com\\.android.*")
        includeGroupByRegex("com\\.google.*")
        includeGroupByRegex("androidx.*")
      }
    }
    mavenCentral()
    gradlePluginPortal()
  }
}

plugins { id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0" }

dependencyResolutionManagement {
  repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
  repositories {
    google()
    mavenCentral()
  }
}

rootProject.name = "OmniAgent"

include(":app")
project(":app").projectDir = file("android/app")

include(":capacitor-cordova-android-plugins")
project(":capacitor-cordova-android-plugins").projectDir = file("android/capacitor-cordova-android-plugins")

include(":capacitor-android")
project(":capacitor-android").projectDir = file("node_modules/@capacitor/android/capacitor")

include(":capacitor-clipboard")
project(":capacitor-clipboard").projectDir = file("node_modules/@capacitor/clipboard/android")

include(":capacitor-community-speech-recognition")
project(":capacitor-community-speech-recognition").projectDir = file("node_modules/@capacitor-community/speech-recognition/android")

include(":capacitor-community-text-to-speech")
project(":capacitor-community-text-to-speech").projectDir = file("node_modules/@capacitor-community/text-to-speech/android")

