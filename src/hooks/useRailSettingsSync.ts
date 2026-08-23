import { useEffect } from "react";
import { listenForRailSettings } from "../stores/railSync";
import { useRailStore } from "../stores/railStore";

/**
 * Keep this window's rail settings in step with the other one.
 *
 * Hive and the rail are separate webviews with separate Zustand stores, so
 * without this a setting changed in one is invisible to the other until a
 * restart — which is exactly why "Combine with Hive" appeared to do nothing
 * when toggled from the rail.
 */
export function useRailSettingsSync() {
  const applyRemoteSettings = useRailStore((s) => s.applyRemoteSettings);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void listenForRailSettings(applyRemoteSettings).then((unlisten) => {
      if (cancelled) unlisten();
      else stop = unlisten;
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [applyRemoteSettings]);
}
