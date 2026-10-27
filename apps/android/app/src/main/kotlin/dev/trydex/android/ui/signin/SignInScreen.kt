package dev.trydex.android.ui.signin

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Dns
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LoadingIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import kotlinx.coroutines.launch
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.trydex.android.AppGraph
import dev.trydex.android.BuildConfig
import dev.trydex.android.R
import dev.trydex.android.data.SignedOutReason
import dev.trydex.android.ui.components.Banner
import dev.trydex.android.ui.components.ErrorText
import dev.trydex.android.ui.components.Tone
import dev.trydex.core.client.DexAuth

@Composable
fun SignInScreen(controller: SignInController, graph: AppGraph) {
    val ui by controller.ui.collectAsStateWithLifecycle()
    val reason by graph.repository.signedOutReason.collectAsStateWithLifecycle()
    val last = graph.preferences.prefs.value.lastServer
    var server by rememberSaveable { mutableStateOf(last?.let(::displayServer) ?: displayServer(BuildConfig.DEFAULT_SERVER)) }
    val host = DexAuth.parseServer(server)?.host

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding(), contentAlignment = Alignment.Center) {
            Column(
                Modifier.widthIn(max = 420.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Image(painterResource(R.drawable.ic_launcher_foreground), contentDescription = null, modifier = Modifier.size(112.dp))
                Text("Sign in to Dex", style = MaterialTheme.typography.headlineMedium, textAlign = TextAlign.Center)
                Text(
                    "Your durable agent, powered by Pi, ClinePass, OpenCode Go, and ChatGPT.",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
                when (reason) {
                    SignedOutReason.Everywhere -> Banner("You signed out of Dex on every device. Sign in again to continue.", tone = Tone.Info)
                    SignedOutReason.Expired -> Banner("Your session ended. Sign in again to continue.", tone = Tone.Info)
                    else -> Unit
                }
                OutlinedTextField(
                    value = server,
                    onValueChange = {
                        server = it
                        controller.dismissError()
                    },
                    label = { Text("Your Dex") },
                    leadingIcon = { Icon(Icons.Rounded.Dns, contentDescription = null) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go, autoCorrectEnabled = false),
                    keyboardActions = KeyboardActions(onGo = { controller.start(server) }),
                    supportingText = { Text("trydex.dev, or the address of the Dex you deployed") },
                    modifier = Modifier.fillMaxWidth().testTag("server"),
                )
                ui.error?.let { ErrorText(it, Modifier.fillMaxWidth()) }
                if (ui.busy) {
                    LoadingIndicator(Modifier.size(56.dp))
                    Text("Signing you in…", style = MaterialTheme.typography.bodyMedium)
                } else {
                    Button(
                        onClick = { controller.start(server) },
                        modifier = Modifier.fillMaxWidth().testTag("sign-in"),
                        contentPadding = ButtonDefaults.ButtonWithIconContentPadding,
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.size(18.dp))
                        Text("Continue in browser", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                if (dev.trydex.android.Demo.available && !ui.busy) {
                    val scope = androidx.compose.runtime.rememberCoroutineScope()
                    androidx.compose.material3.TextButton(onClick = { scope.launch { dev.trydex.android.Demo.start(graph) } }, modifier = Modifier.testTag("demo")) {
                        Text("Try the demo (debug build)")
                    }
                }
                Text(
                    if (host != null) "You'll sign in on $host with GitHub or your password, confirm it's for this app, and come right back."
                    else "You'll sign in in your browser, confirm it's for this app, and come right back.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

/** A server URL as people type it: https:// and the trailing slash left out. */
fun displayServer(url: String) = url.removePrefix("https://").trimEnd('/')
