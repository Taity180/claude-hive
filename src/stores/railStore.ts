import { create } from "zustand";

export type AnchorId =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "tl"
  | "tr"
  | "bl"
  | "br";

export type RestingForm = "nub" | "sliver";
export type OpenOn = "click" | "hover";

/**
 * Versioned: the default edge offset changed from 8 to 14, and settings already
 * on disk would have kept the old value forever — there is no settings UI yet
 * to change it by hand. Bumping the key re-seeds preferences nobody has
 * deliberately set.
 */
export const RAIL_STORAGE_KEY = "claude-hive-rail.v2";

const HORIZONTAL: AnchorId[] = ["top", "bottom"];

/**
 * Whether the rail lies along a horizontal edge, and is therefore wide rather
 * than tall.
 *
 * Corners count as vertical: a corner rail hugs a side, so a tall strip reads
 * correctly there. Only a rail centred on the top or bottom edge is genuinely
 * wide.
 */
export function isHorizontalAnchor(anchor: AnchorId): boolean {
  return HORIZONTAL.includes(anchor);
}

/** A rail on a horizontal edge is wide; on a vertical edge it is tall. */
function defaultSize(anchor: AnchorId): [number, number] {
  return isHorizontalAnchor(anchor) ? [820, 280] : [372, 620];
}

/** The resting strip's dimensions, on the short axis of whichever edge it rests against. */
const NUB_THICKNESS: Record<RestingForm, [number, number]> = {
  // [thickness across the edge, length along it]
  nub: [32, 140],
  sliver: [14, 110],
};

/**
 * Window size for the resting rail.
 *
 * Swapped on a horizontal edge rather than given its own numbers: the rail is
 * the same strip either way, just lying down. Before this it stayed 32×140 on
 * the top and bottom edges — a vertical strip against a horizontal edge.
 */
export function nubSize(anchor: AnchorId, form: RestingForm): [number, number] {
  const [thickness, length] = NUB_THICKNESS[form];
  return isHorizontalAnchor(anchor) ? [length, thickness] : [thickness, length];
}

interface Persisted {
  anchor: AnchorId;
  offset: number;
  restingForm: RestingForm;
  followCursor: boolean;
  sizes: Partial<Record<AnchorId, [number, number]>>;
  /** Hover is faster; click avoids opening it by brushing past the edge. */
  openOn: OpenOn;
  /** Dim the rail while nothing needs the user. */
  hideWhenIdle: boolean;
  /** Panes live inside the Hive window instead of the rail's own. */
  combined: boolean;
  /**
   * App slugs demoted out of the merged feed. Per app rather than per agent, so
   * a noisy Gmail can be quieted without silencing the agent reporting it.
   */
  mutedApps: string[];
}

const DEFAULTS: Persisted = {
  anchor: "right",
  // Held clear of the monitor edge. 8px read as flush against the bezel.
  offset: 14,
  restingForm: "nub",
  followCursor: true,
  sizes: {},
  openOn: "click",
  hideWhenIdle: false,
  combined: false,
  mutedApps: [],
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
  } catch {
    // Corrupt settings should cost the user their preferences, not the window.
    return DEFAULTS;
  }
}

interface RailState extends Persisted {
  /** Deliberately not persisted — a restart should rest, not reopen. */
  open: boolean;
  setAnchor: (a: AnchorId) => void;
  setOffset: (n: number) => void;
  setRestingForm: (f: RestingForm) => void;
  setFollowCursor: (b: boolean) => void;
  setOpen: (b: boolean) => void;
  setSizeForAnchor: (a: AnchorId, size: [number, number]) => void;
  forgetSizeForAnchor: (a: AnchorId) => void;
  currentSize: () => [number, number];
  setOpenOn: (openOn: OpenOn) => void;
  setHideWhenIdle: (hide: boolean) => void;
  setCombined: (combined: boolean) => void;
  toggleAppMuted: (appId: string) => void;
  isAppMuted: (appId: string) => boolean;
}

export const useRailStore = create<RailState>((set, get) => {
  const persist = () => {
    const {
      anchor,
      offset,
      restingForm,
      followCursor,
      sizes,
      openOn,
      hideWhenIdle,
      combined,
      mutedApps,
    } = get();
    try {
      localStorage.setItem(
        RAIL_STORAGE_KEY,
        JSON.stringify({
          anchor,
          offset,
          restingForm,
          followCursor,
          sizes,
          openOn,
          hideWhenIdle,
          combined,
          mutedApps,
        })
      );
    } catch {
      // Private-mode or quota failures are not worth breaking the rail over.
    }
  };

  return {
    ...load(),
    open: false,
    setAnchor: (anchor) => {
      set({ anchor });
      persist();
    },
    setOffset: (offset) => {
      set({ offset });
      persist();
    },
    setRestingForm: (restingForm) => {
      set({ restingForm });
      persist();
    },
    setFollowCursor: (followCursor) => {
      set({ followCursor });
      persist();
    },
    setOpen: (open) => set({ open }),
    setSizeForAnchor: (a, size) => {
      set({ sizes: { ...get().sizes, [a]: size } });
      persist();
    },
    forgetSizeForAnchor: (a) => {
      const { [a]: _dropped, ...rest } = get().sizes;
      set({ sizes: rest });
      persist();
    },
    setOpenOn: (openOn) => {
      set({ openOn });
      persist();
    },
    setHideWhenIdle: (hideWhenIdle) => {
      set({ hideWhenIdle });
      persist();
    },
    setCombined: (combined) => {
      set({ combined });
      persist();
    },
    toggleAppMuted: (appId) => {
      const current = get().mutedApps;
      set({
        mutedApps: current.includes(appId)
          ? current.filter((id) => id !== appId)
          : [...current, appId],
      });
      persist();
    },
    isAppMuted: (appId) => get().mutedApps.includes(appId),
    currentSize: () => {
      const { anchor, sizes } = get();
      return sizes[anchor] ?? defaultSize(anchor);
    },
  };
});
