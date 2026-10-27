package dev.trydex.core.model

/**
 * Makes a web page's sound play on phones (apps/web/src/shared/web-audio.ts, kept identical; WebAudioTest checks it):
 * audio may only start in a tap's `touchend` or `click`, not the `touchstart` games tend to listen to, so the script
 * wraps AudioContext and resumes every context the page makes on each tap, click, or key press, and starts a looping
 * silent `<audio>` on the first (which, on iPhone, also takes the page out of the Ring/Silent switch's reach).
 * The app adds it to HTML it previews.
 */
object WebAudio {
    const val UNLOCK_SCRIPT = """<script>
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
</script>"""

    private val PLACES = listOf(Regex("<head[^>]*>", RegexOption.IGNORE_CASE), Regex("<html[^>]*>", RegexOption.IGNORE_CASE), Regex("<!doctype[^>]*>", RegexOption.IGNORE_CASE))

    /**
     * `html` with the audio unlock as its first script: right after `<head>`, else `<html>`, else the doctype (never
     * before it, which would put the page in quirks mode), else at the very start.
     */
    fun withAudioUnlock(html: String): String {
        if ("__dexUnlock" in html) return html
        for (tag in PLACES) {
            val match = tag.find(html) ?: continue
            val end = match.range.last + 1
            return html.substring(0, end) + UNLOCK_SCRIPT + html.substring(end)
        }
        return UNLOCK_SCRIPT + html
    }
}
