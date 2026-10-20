package dev.trydex.android.ui.openui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.PrimaryScrollableTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.trydex.openui.ElementNode
import dev.trydex.openui.Js

@Composable
private fun Chevron(open: Boolean, closedRotation: Float = 0f) {
    val angle by animateFloatAsState(if (open) 180f else closedRotation, label = "chevron")
    Icon(Icons.Rounded.ExpandMore, contentDescription = null, modifier = Modifier.rotate(angle), tint = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * Sections, any number open. While streaming each new one opens; when it ends (or on a finished message) only the
 * first stays open, until you open or close one yourself.
 */
@Composable
fun SectionBlock(node: ElementNode) {
    val ui = LocalOpenUI.current
    val p = node.p
    val sections = p.nodes("sections")
    val values = sections.map { it.p.text("value") }
    val foldable = p.bool("isFoldable") != false
    var open by remember { mutableStateOf(setOfNotNull(values.firstOrNull())) }
    var touched by remember { mutableStateOf(false) }
    var seen by remember { mutableIntStateOf(sections.size) }
    LaunchedEffect(sections.size, ui.streaming) {
        if (touched) return@LaunchedEffect
        if (ui.streaming && sections.size > seen) open = open + values.last()
        else if (!ui.streaming) open = setOfNotNull(values.firstOrNull())
        else if (open.isEmpty()) values.firstOrNull()?.let { open = setOf(it) }
        seen = sections.size
    }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(if (foldable) 4.dp else 12.dp)) {
        sections.forEachIndexed { index, section ->
            val sp = section.p
            val value = values[index]
            val isOpen = !foldable || value in open
            Column(Modifier.fillMaxWidth()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp))
                        .then(
                            if (foldable) Modifier.clickable(role = Role.Button) {
                                touched = true
                                open = if (isOpen) open - value else open + value
                            } else Modifier,
                        )
                        .padding(vertical = 12.dp)
                        .semantics { heading(); if (foldable) stateDescription = if (isOpen) "Expanded" else "Collapsed" },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    if (foldable) Chevron(isOpen, closedRotation = -90f)
                    Text(sp.text("trigger"), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                }
                AnimatedVisibility(isOpen) {
                    RenderChildren(sp.list("content"), Modifier.padding(start = if (foldable) 32.dp else 0.dp, bottom = 12.dp), gap = 16)
                }
            }
        }
    }
}

/** Tabs: until you pick one, the tab whose content is still growing is shown; a finished message shows the first. */
@Composable
fun TabsView(node: ElementNode) {
    val ui = LocalOpenUI.current
    val tabs = node.p.nodes("items").filter { it.p.has("value") }
    if (tabs.isEmpty()) return
    var selected by remember { mutableIntStateOf(0) }
    var touched by remember { mutableStateOf(false) }
    val sizes = tabs.map { Js.json(it.props["content"]).length }
    var previous by remember { mutableStateOf(sizes) }
    LaunchedEffect(sizes) {
        if (!touched && ui.streaming) {
            val grown = sizes.indices.lastOrNull { it >= previous.size || sizes[it] > previous[it] }
            if (grown != null) selected = grown
        }
        previous = sizes
    }
    if (selected > tabs.lastIndex) selected = tabs.lastIndex
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PrimaryScrollableTabRow(selectedTabIndex = selected, edgePadding = 0.dp, containerColor = androidx.compose.ui.graphics.Color.Transparent) {
            tabs.forEachIndexed { index, tab ->
                Tab(
                    selected = index == selected,
                    onClick = {
                        touched = true
                        selected = index
                    },
                    text = { Text(tab.p.text("trigger"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    modifier = Modifier.testTag("openui-tab"),
                )
            }
        }
        RenderChildren(tabs[selected].p.list("content"), gap = 16)
    }
}

/** One item open at a time; while streaming, each new item opens. */
@Composable
fun AccordionView(node: ElementNode) {
    val items = node.p.nodes("items")
    if (items.isEmpty()) return
    var open by remember { mutableStateOf<String?>(items.last().p.text("value")) }
    var touched by remember { mutableStateOf(false) }
    var seen by remember { mutableIntStateOf(items.size) }
    if (items.size > seen) {
        if (!touched) open = items.last().p.text("value")
        seen = items.size
    }
    Column(Modifier.fillMaxWidth()) {
        items.forEachIndexed { index, item ->
            val value = item.p.text("value")
            val isOpen = open == value
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button) {
                    touched = true
                    open = if (isOpen) null else value
                }.padding(vertical = 16.dp).semantics { stateDescription = if (isOpen) "Expanded" else "Collapsed" },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(item.p.text("trigger"), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                Chevron(isOpen)
            }
            AnimatedVisibility(isOpen) {
                RenderChildren(item.p.list("content"), Modifier.padding(bottom = 16.dp))
            }
            if (index < items.lastIndex) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** Slides side by side, snapping to each one's start. */
@Composable
fun CarouselView(node: ElementNode) {
    val p = node.p
    val slides = p.list("children").map { slide -> slide as? List<*> ?: listOf(slide) }
    if (slides.isEmpty()) return
    val sunk = p.str("variant") == "sunk"
    val state = rememberLazyListState()
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val width = if (maxWidth <= 400.dp) 248.dp else 280.dp
        LazyRow(
            state = state,
            flingBehavior = rememberSnapFlingBehavior(state),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxWidth().testTag("openui-carousel"),
        ) {
            itemsIndexed(slides) { _, slide ->
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = if (sunk) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.surfaceContainerHigh,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.width(width),
                ) {
                    RenderChildren(slide, Modifier.padding(12.dp))
                }
            }
        }
    }
}
