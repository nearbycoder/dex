/**
 * Development aid: with `sessionStorage["dex-skeleton"] = "1"`, the app behaves as if nothing has loaded yet (no
 * synced state, no transcripts, no page data), so every skeleton can be compared with the page it stands in for.
 * Never active in production builds.
 */
export const skeletonPreview = (): boolean =>
  import.meta.env.DEV && typeof sessionStorage !== "undefined" && sessionStorage.getItem("dex-skeleton") === "1"
