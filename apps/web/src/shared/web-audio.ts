/**
 * Makes a web page's sound play on iPhone and iPad, where pages built for desktops (games especially) are often
 * silent for two reasons:
 * - Audio may only start in a tap's `touchend` or `click` (not the `touchstart` games tend to listen to), so an
 *   AudioContext made or resumed from a `touchstart` stays suspended.
 * - The Ring/Silent switch mutes Web Audio, unless a media element is playing: a looping silent one (and, where
 *   Safari has it, `navigator.audioSession.type = "playback"`) moves the page into a playback session.
 *
 * As the first script of a page, it wraps AudioContext so every context the page makes (directly or through a library
 * such as Howler or Tone.js) is resumed on each tap, click, or key press, and starts the silent loop on the first.
 * Dex adds it to HTML it previews, and tells the model to put it in pages with sound it builds.
 */
export const AUDIO_UNLOCK_SCRIPT = `<script>
(() => {
  const Base = window.AudioContext || window.webkitAudioContext;
  if (!Base || Base.__dexUnlock) return;
  const contexts = new Set();
  class Context extends Base {
    constructor(...args) { super(...args); contexts.add(this); }
  }
  Context.__dexUnlock = true;
  window.AudioContext = window.webkitAudioContext = Context;
  const silence = new Audio("data:audio/wav;base64,UklGRnQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YVAAAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==");
  silence.loop = true;
  silence.setAttribute("playsinline", "");
  const unlock = () => {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
    if (silence.paused) silence.play().catch(() => {});
    for (const context of contexts) if (context.state !== "running") context.resume().catch(() => {});
  };
  for (const type of ["touchend", "pointerup", "click", "keydown"]) addEventListener(type, unlock, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) for (const context of contexts) context.resume().catch(() => {}); });
})();
</script>`

/**
 * `html` with the audio unlock as its first script: right after `<head>`, else `<html>`, else the doctype (never
 * before it, which would put the page in quirks mode), else at the very start.
 */
export function withAudioUnlock(html: string): string {
  if (html.includes("__dexUnlock")) return html
  for (const tag of [/<head[^>]*>/i, /<html[^>]*>/i, /<!doctype[^>]*>/i]) {
    const match = tag.exec(html)
    if (match) return html.slice(0, match.index + match[0].length) + AUDIO_UNLOCK_SCRIPT + html.slice(match.index + match[0].length)
  }
  return AUDIO_UNLOCK_SCRIPT + html
}
