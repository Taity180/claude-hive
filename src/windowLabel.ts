/**
 * Which Tauri window this bundle is running in. Both windows load the same
 * index.html, so this is what decides whether to render Hive or the Rail.
 * Read synchronously off the internals Tauri injects, because the async
 * `getCurrentWindow()` would mean a frame of the wrong UI before it resolved.
 */
export function currentWindowLabel(): string {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } };
    }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label ?? "main";
}
