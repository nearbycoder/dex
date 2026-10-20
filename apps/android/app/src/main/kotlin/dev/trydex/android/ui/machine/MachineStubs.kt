package dev.trydex.android.ui.machine

import androidx.compose.runtime.Composable
import dev.trydex.android.ui.components.DetailPlaceholder

@Composable
fun MachineListScreen() { DetailPlaceholder("Coming soon") }

@Composable
fun MachineScreen(key: String, beside: Boolean = false) { DetailPlaceholder("Coming soon") }

@Composable
fun PipDesktop(graph: dev.trydex.android.AppGraph, source: dev.trydex.android.ui.PipSource) { DetailPlaceholder("Coming soon") }

@Composable
fun VmPreview(vm: dev.trydex.core.model.VmInfo, title: String) {}
