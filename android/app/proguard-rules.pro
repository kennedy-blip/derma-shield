# DERMA-SHIELD · keep the Capacitor bridge and the two native plugins visible
# to reflection-based plugin discovery.
-keep class com.getcapacitor.** { *; }
-keep class com.dermashield.bio.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public <methods>;
}
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod
-dontwarn org.apache.commons.**
