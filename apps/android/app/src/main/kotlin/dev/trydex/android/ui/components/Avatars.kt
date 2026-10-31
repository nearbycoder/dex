package dev.trydex.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Chat
import androidx.compose.material.icons.automirrored.rounded.MenuBook
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.CalendarMonth
import androidx.compose.material.icons.rounded.Code
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Language
import androidx.compose.material.icons.rounded.MergeType
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Psychology
import androidx.compose.material.icons.rounded.RocketLaunch
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SmartToy
import androidx.compose.material.icons.rounded.Storage
import androidx.compose.material.icons.rounded.Terminal
import androidx.compose.material.icons.rounded.TravelExplore
import androidx.compose.material.icons.rounded.VerifiedUser
import androidx.compose.material.icons.rounded.WorkOutline
import androidx.compose.material.icons.rounded.Build
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import androidx.compose.foundation.shape.CircleShape
import dev.trydex.core.model.Catalogs
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.ModelRegistry
import kotlin.math.max
import kotlin.math.roundToInt

/** Agent and project icons, by the web's keys (lucide names), as Material Symbols. */
fun agentIcon(key: String): ImageVector = when (key) {
    "bot" -> Icons.Rounded.SmartToy
    "git-pull-request" -> Icons.Rounded.MergeType
    "shield-check" -> Icons.Rounded.VerifiedUser
    "search-code" -> Icons.Rounded.Search
    "bug" -> Icons.Rounded.BugReport
    "rocket" -> Icons.Rounded.RocketLaunch
    "pen-line" -> Icons.Rounded.Edit
    "book-open" -> Icons.AutoMirrored.Rounded.MenuBook
    "terminal" -> Icons.Rounded.Terminal
    "database" -> Icons.Rounded.Storage
    "globe" -> Icons.Rounded.Language
    "telescope" -> Icons.Rounded.TravelExplore
    "chart" -> Icons.Rounded.BarChart
    "brain" -> Icons.Rounded.Psychology
    "wrench" -> Icons.Rounded.Build
    "palette" -> Icons.Rounded.Palette
    "lightbulb" -> Icons.Rounded.Lightbulb
    "mail" -> Icons.Rounded.Email
    "calendar" -> Icons.Rounded.CalendarMonth
    "briefcase" -> Icons.Rounded.WorkOutline
    "messages" -> Icons.AutoMirrored.Rounded.Chat
    "code" -> Icons.Rounded.Code
    "file-text" -> Icons.Rounded.Description
    "sparkles" -> Icons.Rounded.AutoAwesome
    else -> Icons.Rounded.SmartToy
}

/**
 * An agent's or project's avatar: its icon on its color, or a project's picture (a data: URL from its repo). The
 * corner radius follows the web's `size × 0.28`.
 */
@Composable
fun AgentAvatar(icon: String, color: String, size: Dp = 32.dp, image: String? = null, modifier: Modifier = Modifier) {
    val radius = (size.value * 0.28f).roundToInt().dp
    val shape = RoundedCornerShape(radius)
    if (!image.isNullOrEmpty()) {
        Box(
            modifier.size(size).clip(shape).background(MaterialTheme.colorScheme.surfaceContainerHighest)
                .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
                .padding(max(1f, (size.value * 0.14f)).dp),
            contentAlignment = Alignment.Center,
        ) {
            AsyncImage(model = image, contentDescription = null, contentScale = ContentScale.Fit)
        }
        return
    }
    val (background, foreground) = Catalogs.agentColor(color)
    Box(modifier.size(size).clip(shape).background(Color(background)), contentAlignment = Alignment.Center) {
        Icon(agentIcon(icon), contentDescription = null, tint = Color(foreground), modifier = Modifier.size(size * 0.56f))
    }
}

/**
 * A character's face: their picture, or their emoji (else their initial) on their color. Round, unlike agents and
 * projects, so a character reads as someone rather than something.
 */
@Composable
fun CharacterAvatar(character: CharacterProfile, size: Dp = 32.dp, modifier: Modifier = Modifier) {
    val (background, foreground) = Catalogs.AGENT_COLORS[character.color] ?: Catalogs.agentColor("violet")
    val image = character.image
    if (!image.isNullOrEmpty()) {
        Box(modifier.size(size).clip(CircleShape).background(Color(background)).border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)) {
            AsyncImage(model = image, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.size(size))
        }
        return
    }
    Box(modifier.size(size).clip(CircleShape).background(Color(background)), contentAlignment = Alignment.Center) {
        Text(
            character.face,
            color = Color(foreground),
            fontSize = (size.value * if (character.avatar.isNotEmpty()) 0.5f else 0.45f).sp,
            fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold,
            maxLines = 1,
            style = androidx.compose.ui.text.TextStyle(platformStyle = androidx.compose.ui.text.PlatformTextStyle(includeFontPadding = false)),
        )
    }
}

/** The logo of the company that makes a model (bundled from apps/web/public/models), tinted for the theme. */
@Composable
fun ModelLogo(modelId: String, models: ModelRegistry, size: Dp = 16.dp, modifier: Modifier = Modifier) {
    val model = models.find(modelId) ?: return
    AsyncImage(
        model = "file:///android_asset/models/${model.maker}.svg",
        contentDescription = model.modelMaker?.displayName,
        colorFilter = ColorFilter.tint(MaterialTheme.colorScheme.onSurface),
        modifier = modifier.size(size),
    )
}

/** The viewer's GitHub avatar, or the first letter of their name. */
@Composable
fun UserAvatar(name: String, avatarUrl: String?, size: Dp = 32.dp) {
    if (avatarUrl != null) {
        AsyncImage(model = avatarUrl, contentDescription = null, modifier = Modifier.size(size).clip(RoundedCornerShape(50)))
    } else {
        Box(Modifier.size(size).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Text(name.take(1).uppercase(), color = MaterialTheme.colorScheme.onPrimaryContainer, fontSize = (size.value * 0.45f).sp)
        }
    }
}
