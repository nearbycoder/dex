package dev.trydex.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.abs
import kotlin.math.roundToLong

/** The models Dex runs, from ClinePass, OpenCode Go, ChatGPT, Command Code, and OpenRouter (apps/web/src/shared/models.ts). */
@Serializable
enum class ModelProvider(val id: String, val displayName: String, val short: String) {
    @SerialName("clinepass") ClinePass("clinepass", "ClinePass", "Cline"),
    @SerialName("opencode-go") OpenCodeGo("opencode-go", "OpenCode Go", "OpenCode"),
    @SerialName("chatgpt") ChatGPT("chatgpt", "ChatGPT", "ChatGPT"),

    /** Only from the live catalog (no built-ins), and only while a key is connected. Its ids are `commandcode/<apiId>`, and an apiId can hold a slash. */
    @SerialName("commandcode") CommandCode("commandcode", "Command Code", "Command"),

    /** Its free models only, from the live catalog (no built-ins), listed whether or not a key is connected. Its ids are `openrouter/<apiId>`, and an apiId holds a slash. */
    @SerialName("openrouter") OpenRouter("openrouter", "OpenRouter", "OpenRouter");

    companion object {
        fun fromId(id: String): ModelProvider? = entries.firstOrNull { it.id == id }
    }
}

/** Who makes each model family; `logo` is the SVG under /public/models on the web (bundled in the app). */
enum class ModelMaker(val id: String, val displayName: String) {
    Zai("zai", "Z.ai"),
    Moonshot("moonshot", "Moonshot AI"),
    DeepSeek("deepseek", "DeepSeek"),
    Qwen("qwen", "Alibaba Qwen"),
    MiniMax("minimax", "MiniMax"),
    Xiaomi("xiaomi", "Xiaomi"),
    Meta("meta", "Meta"),
    Anthropic("anthropic", "Anthropic"),
    OpenAI("openai", "OpenAI"),
    XAI("xai", "xAI"),
    Google("google", "Google"),
    Meituan("meituan", "Meituan"),
    Tencent("tencent", "Tencent"),
    StepFun("stepfun", "StepFun"),
    OpenCode("opencode", "OpenCode"),

    /** Other makers Command Code serves (Mistral, NVIDIA, Sakana, …), under its ⌘ mark. */
    CommandCode("commandcode", "Command Code"),

    /** Stealth models (their maker unannounced) and makers without a logo here, on Cline. */
    Other("other", "Other");

    companion object {
        fun fromId(id: String): ModelMaker? = entries.firstOrNull { it.id == id }
    }
}

@Serializable
data class ModelCost(
    val input: Double = 0.0,
    val output: Double = 0.0,
    val cacheRead: Double = 0.0,
    val cacheWrite: Double = 0.0,
)

@Serializable
data class DexModel(
    val id: String,
    val apiId: String = id,
    val provider: String = "clinepass",
    val name: String = id,
    val maker: String = "opencode",
    val input: List<String> = listOf("text"),
    val contextWindow: Long = 0,
    val maxTokens: Long = 0,
    val cost: ModelCost = ModelCost(),
    /** Levels mapped to the provider's own: a JSON null marks a level the model rejects; a missing key is the default. */
    val thinkingLevelMap: JsonObject? = null,
    val trainsOnData: Boolean = false,
    /** When the model came out ("2026-11-03"), from the catalogs; missing from older agents and when none says. */
    val releasedAt: String? = null,
) {
    val modelProvider: ModelProvider get() = ModelProvider.fromId(provider) ?: ModelProvider.ClinePass
    val modelMaker: ModelMaker? get() = ModelMaker.fromId(maker)
    val hasVision: Boolean get() = "image" in input
    val free: Boolean get() = cost.input == 0.0 && cost.output == 0.0
}

@Serializable
data class ModelCatalog(val version: String = "", val updatedAt: Long = 0, val models: List<DexModel> = emptyList())

const val DEFAULT_MODEL_ID = "cline-pass/glm-5.3"
val DEFAULT_THINKING = ThinkingLevel.Low

/**
 * The model list in use: the built-in one until the agent sends a fresher catalog. Mirrors the web's `MODELS` array that
 * `setModelCatalog` updates in place.
 */
class ModelRegistry(initial: List<DexModel> = BuiltInModels.list) {
    @Volatile var models: List<DexModel> = initial
        private set
    @Volatile var updatedAt: Long = 0
        private set
    @Volatile var version: String? = null
        private set

    /**
     * Installs a refreshed list unless one checked more recently is in place. Models from a maker or provider this build
     * doesn't know are left out, and an empty list changes nothing.
     */
    fun install(catalog: ModelCatalog): Boolean {
        val known = catalog.models.filter { ModelMaker.fromId(it.maker) != null && ModelProvider.fromId(it.provider) != null }
        if (catalog.updatedAt < updatedAt || known.isEmpty()) return false
        models = known
        updatedAt = catalog.updatedAt
        version = catalog.version
        return true
    }

    fun find(id: String): DexModel? = models.firstOrNull { it.id == id }

    fun of(provider: ModelProvider): List<DexModel> = models.filter { it.modelProvider == provider }

    /** The default model, or the first one listed if the provider retired it. */
    fun defaultModelId(): String = if (find(DEFAULT_MODEL_ID) != null) DEFAULT_MODEL_ID else models.firstOrNull()?.id ?: DEFAULT_MODEL_ID

    /** Which subscription a chat's model runs on (an unlisted id goes by its prefix, else ClinePass, as on the web). */
    fun providerOf(id: String): ModelProvider =
        find(id)?.modelProvider ?: when {
            id.startsWith("opencode-go/") -> ModelProvider.OpenCodeGo
            id.startsWith("chatgpt/") -> ModelProvider.ChatGPT
            id.startsWith("commandcode/") -> ModelProvider.CommandCode
            id.startsWith("openrouter/") -> ModelProvider.OpenRouter
            else -> ModelProvider.ClinePass
        }

    /** The same model on the other provider, when it offers it. */
    fun counterpart(id: String, provider: ModelProvider): DexModel? {
        val model = find(id) ?: return null
        if (model.modelProvider == provider) return model
        val slug = model.apiId.removePrefix("cline-pass/")
        return models.firstOrNull { it.modelProvider == provider && it.apiId.removePrefix("cline-pass/") == slug }
    }

    /**
     * A model that runs with the subscriptions connected: `id` if its own is, else the same model on a connected one,
     * else that one's first model. Unchanged when nothing is connected.
     */
    fun usableModel(id: String, connected: Map<ModelProvider, Boolean>): String {
        if (connected[providerOf(id)] == true) return id
        val other = ModelProvider.entries.firstOrNull { connected[it] == true } ?: return id
        return (counterpart(id, other) ?: models.firstOrNull { it.modelProvider == other })?.id ?: id
    }
}

/** The levels the thinking menu offers for a model, by pi-ai's rules (see supportedThinkingLevels on the web). */
fun supportedThinkingLevels(model: DexModel?): List<ThinkingLevel> {
    if (model == null) return emptyList()
    val map = model.thinkingLevelMap ?: JsonObject(emptyMap())
    fun present(key: String) = map.containsKey(key) && map[key] !is JsonNull
    return ThinkingLevel.entries.filter { level ->
        if (level == ThinkingLevel.XHigh) present("xhigh") || present("max") else map[level.id] !is JsonNull || !map.containsKey(level.id)
    }
}

/** The requested level if the model supports it, else the nearest supported one (ties keep the lower level). */
fun clampThinking(model: DexModel?, level: ThinkingLevel): ThinkingLevel {
    val supported = supportedThinkingLevels(model)
    if (supported.isEmpty() || level in supported) return level
    return supported.reduce { best, candidate ->
        if (abs(candidate.ordinal - level.ordinal) < abs(best.ordinal - level.ordinal)) candidate else best
    }
}

/** A context window for people: 131072 → "128K", 1048576 → "1M" (K is 1024, M is a million, as on the web). */
fun formatTokens(tokens: Long): String =
    if (tokens >= 1_000_000) "${(tokens / 1_000_000.0).roundHalfUp()}M" else "${(tokens / 1024.0).roundHalfUp()}K"

/** How long a model counts as new (a badge in the menus). */
const val NEW_MODEL_DAYS = 14

/**
 * The UTC midnight a release date starts at, read as JavaScript's `Date.parse("YYYY-MM-DDT00:00:00Z")` does: only that
 * shape counts, and a day past the month's end rolls into the next month ("2026-02-30" is Mar 2).
 */
private fun releaseStart(releasedAt: String?): Long? {
    val match = Regex("""(\d{4})-(\d{2})-(\d{2})""").matchEntire(releasedAt?.take(10) ?: return null) ?: return null
    val (year, month, day) = match.destructured.toList().map { it.toInt() }
    if (month !in 1..12 || day !in 1..31) return null
    return LocalDate.of(year, month, 1).plusDays(day - 1L).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
}

/** Days since a model came out, or null when that isn't known. */
fun daysSinceRelease(model: DexModel, now: Long = System.currentTimeMillis()): Int? {
    val released = releaseStart(model.releasedAt) ?: return null
    return maxOf(0L, Math.floorDiv(now - released, 86_400_000L)).toInt()
}

fun isNewModel(model: DexModel, now: Long = System.currentTimeMillis()): Boolean = (daysSinceRelease(model, now) ?: Int.MAX_VALUE) <= NEW_MODEL_DAYS

/** When a model came out, for its row: "Nov 3" this year, "Mar 2025" before (UTC, as on the web). */
fun releaseLabel(model: DexModel, now: Long = System.currentTimeMillis(), locale: Locale = Locale.getDefault()): String? {
    val released = releaseStart(model.releasedAt) ?: return null
    val date = Instant.ofEpochMilli(released).atZone(ZoneOffset.UTC).toLocalDate()
    val thisYear = date.year == Instant.ofEpochMilli(now).atZone(ZoneOffset.UTC).year
    return date.format(DateTimeFormatter.ofPattern(if (thisYear) "MMM d" else "MMM yyyy", locale))
}

/** The newest-first list's sections, by how long ago a model came out; the last holds models without a date. */
enum class ReleasePeriod(val days: Int?, val label: String) {
    Week(7, "This week"),
    Month(30, "This month"),
    Quarter(90, "Past 3 months"),
    Earlier(Int.MAX_VALUE, "Earlier"),
    Unknown(null, "Release date unknown");

    companion object {
        fun of(model: DexModel, now: Long = System.currentTimeMillis()): ReleasePeriod {
            val days = daysSinceRelease(model, now) ?: return Unknown
            return entries.first { it.days != null && days <= it.days }
        }
    }
}

/** The newest-first menu's "released within" filter (0: any time). */
enum class ReleasedWithin(val days: Int, val label: String) {
    AnyTime(0, "Any time"),
    Week(7, "7 days"),
    Month(30, "30 days"),
    Quarter(90, "90 days");

    fun includes(model: DexModel, now: Long = System.currentTimeMillis()): Boolean =
        days == 0 || (daysSinceRelease(model, now) ?: Int.MAX_VALUE) <= days
}

/**
 * Every model newest first, in [ReleasePeriod] sections (empty ones left out): by release date, then models on a
 * connected subscription first, as the web's Newest menu orders them.
 */
fun newestFirst(models: List<DexModel>, connected: Map<ModelProvider, Boolean>, now: Long = System.currentTimeMillis()): List<Pair<ReleasePeriod, List<DexModel>>> {
    val sorted = models.sortedWith(
        compareByDescending<DexModel> { it.releasedAt.orEmpty() }.thenByDescending { connected[it.modelProvider] == true },
    )
    return ReleasePeriod.entries.map { period -> period to sorted.filter { ReleasePeriod.of(it, now) == period } }.filter { it.second.isNotEmpty() }
}

/** JavaScript's Math.round: halves round up (towards +∞). */
internal fun Double.roundHalfUp(): Long = kotlin.math.floor(this + 0.5).roundToLong()

object BuiltInModels {
    val list: List<DexModel> by lazy {
        val text = BuiltInModels::class.java.getResourceAsStream("/dev/trydex/core/model/built-in-models.json")!!.bufferedReader().use { it.readText() }
        DexJson.decodeFromString(ModelCatalog.serializer(), text).models
    }
}
