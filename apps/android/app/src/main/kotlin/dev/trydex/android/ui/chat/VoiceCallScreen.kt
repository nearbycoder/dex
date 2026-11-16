package dev.trydex.android.ui.chat

import android.Manifest
import android.animation.ValueAnimator
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.rounded.CallEnd
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.MicOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalIconToggleButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.ui.LocalApp
import dev.trydex.android.ui.components.CharacterAvatar
import dev.trydex.android.ui.theme.DexTheme
import dev.trydex.core.model.CharacterProfile
import dev.trydex.core.model.TranscriptState
import dev.trydex.core.model.Voices
import dev.trydex.core.voice.CallPhase
import dev.trydex.core.voice.VoiceCall
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/**
 * A chat's voice call with its sidekick (the web's voice-call.tsx): the Call button asks for the microphone (saying why
 * first), and the call, once started, lives as long as the chat is on screen and the app in front.
 */
@Stable
class ChatCall(
    val scope: CoroutineScope,
    val snackbar: SnackbarHostState,
    private val start: (CharacterProfile) -> VoiceCall,
) {
    var call by mutableStateOf<VoiceCall?>(null)
        private set
    /** Asking for the microphone, for this sidekick. */
    var asking by mutableStateOf<CharacterProfile?>(null)

    fun begin(character: CharacterProfile) {
        if (call == null) call = start(character)
    }

    fun end() {
        call?.end()
        call = null
    }

    fun say(message: String) = scope.launch { snackbar.showSnackbar(message) }
}

/** Calls in a chat: the call's state, the microphone permission, and ending it when the chat or the app goes away. */
@Composable
fun rememberChatCall(sessionId: String, snackbar: SnackbarHostState, send: suspend (String) -> Unit): ChatCall {
    val app = LocalApp.current
    val devices = app.graph.voice
    // The call's own work runs on the main thread, not paced by frames.
    val scope = rememberCoroutineScope { Dispatchers.Main }
    val chatCall = remember(sessionId) {
        ChatCall(scope, snackbar) { character ->
            VoiceCall(Voices.voiceOf(character), send, devices.recognition(), devices.speech, devices.player(), scope).also { it.start() }
        }
    }
    // Leaving the chat, or the app (the microphone can't be used from the background), ends the call.
    DisposableEffect(chatCall) { onDispose { chatCall.end() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { chatCall.end() }
    // The call holds the device's audio while it lasts.
    val call = chatCall.call
    DisposableEffect(call) {
        val release = if (call != null) devices.claimAudio() else null
        onDispose { release?.invoke() }
    }
    return chatCall
}

/** The bar's Call button: the microphone first (with why), then the call. */
@Composable
fun CallButton(character: CharacterProfile, chatCall: ChatCall, enabled: Boolean) {
    val context = LocalContext.current
    val devices = LocalApp.current.graph.voice
    val activity = context as? android.app.Activity
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        when {
            granted -> chatCall.begin(character)
            // Denied for good: only Settings can allow it now.
            activity != null && !activity.shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO) -> chatCall.scope.launch {
                val result = chatCall.snackbar.showSnackbar("Calls need the microphone. Allow it in Settings.", actionLabel = "Settings", duration = SnackbarDuration.Long)
                if (result == SnackbarResult.ActionPerformed) {
                    context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }
            }
            else -> chatCall.say("Calls need the microphone.")
        }
    }
    IconButton(
        onClick = {
            val reason = devices.unavailable()
            when {
                reason != null -> chatCall.say(reason)
                ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED -> chatCall.begin(character)
                else -> chatCall.asking = character
            }
        },
        enabled = enabled && chatCall.call == null,
        modifier = Modifier.testTag("character-call"),
    ) {
        Icon(Icons.Outlined.Call, contentDescription = "Call ${character.name}")
    }
    chatCall.asking?.let { asking ->
        AlertDialog(
            onDismissRequest = { chatCall.asking = null },
            title = { Text("Talk with ${asking.name}") },
            text = {
                Text(
                    "On a call, Dex listens through your microphone with your phone's own speech recognition, and sends what you say to " +
                        "${asking.name} as a message. ${asking.name} answers out loud. It listens only while the call is open.",
                )
            },
            confirmButton = {
                TextButton(onClick = { chatCall.asking = null; permission.launch(Manifest.permission.RECORD_AUDIO) }, modifier = Modifier.testTag("call-allow-microphone")) {
                    Text("Allow microphone")
                }
            },
            dismissButton = { TextButton(onClick = { chatCall.asking = null }) { Text("Not now") } },
        )
    }
}

/**
 * A call in progress, over the chat: their face (it moves with their voice), how the call is going, what they're
 * saying or what you just said, and Mute and End.
 */
@Composable
fun VoiceCallScreen(call: VoiceCall, character: CharacterProfile, transcript: StateFlow<TranscriptState>, onClose: () -> Unit) {
    val state by call.state.collectAsStateWithLifecycle()
    // Their reply, as the chat has it, read as it streams.
    LaunchedEffect(call) { transcript.collect { call.reply(Voices.latestReply(it)) } }
    // Their voice's loudness, each frame while they speak (unless animations are off).
    var level by remember { mutableFloatStateOf(0f) }
    val speaking = state.phase == CallPhase.Speaking
    LaunchedEffect(call, speaking) {
        level = 0f
        if (speaking && ValueAnimator.areAnimatorsEnabled()) while (true) withFrameNanos { level = call.level() }
    }
    BackHandler { onClose() }
    val over = state.over
    Box(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surface).windowInsetsPadding(WindowInsets.safeDrawing).testTag("voice-call"),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.widthIn(max = 480.dp).fillMaxSize().padding(horizontal = 24.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Column(
                Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
            ) {
                // Their face grows a little with their voice.
                Box(Modifier.graphicsLayer { val scale = 1f + level * 0.12f; scaleX = scale; scaleY = scale }) {
                    CharacterAvatar(character, size = 160.dp, live = !over)
                }
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(character.name, style = MaterialTheme.typography.headlineSmall, color = MaterialTheme.colorScheme.onSurface)
                    Text(
                        state.status,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (state.phase == CallPhase.Listening && !state.muted) DexTheme.colors.success else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 4.dp).testTag("call-status").semantics { liveRegion = LiveRegionMode.Polite },
                    )
                }
                Column(Modifier.fillMaxWidth().heightIn(min = 96.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    if (state.saying.isNotEmpty()) {
                        Text(state.saying, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.testTag("call-saying"))
                    } else if (state.heard.isNotEmpty()) {
                        Text("“${state.heard}”", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.testTag("call-heard"))
                    }
                    state.error?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, textAlign = TextAlign.Center, modifier = Modifier.testTag("call-error")) }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
                if (!over) {
                    FilledTonalIconToggleButton(
                        checked = state.muted,
                        onCheckedChange = { call.setMuted(it) },
                        modifier = Modifier.size(64.dp).testTag("call-mute"),
                    ) {
                        Icon(if (state.muted) Icons.Rounded.MicOff else Icons.Rounded.Mic, contentDescription = if (state.muted) "Unmute" else "Mute", modifier = Modifier.size(28.dp))
                    }
                }
                FilledIconButton(
                    onClick = onClose,
                    colors = IconButtonDefaults.filledIconButtonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                    modifier = Modifier.size(64.dp).testTag("call-end"),
                ) {
                    Icon(Icons.Rounded.CallEnd, contentDescription = if (over) "Close" else "End call", modifier = Modifier.size(28.dp))
                }
            }
        }
    }
}
