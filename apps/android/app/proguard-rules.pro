# kotlinx.serialization keeps its generated serializers through its own rules; keep the models' companions too.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers @kotlinx.serialization.Serializable class ** {
    *** Companion;
    kotlinx.serialization.KSerializer serializer(...);
}
-dontwarn org.commonmark.**
-dontwarn okhttp3.internal.**
