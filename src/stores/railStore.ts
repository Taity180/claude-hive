import { create } from "zustand";
import { broadcastRailSettings } from "./railSync";

/**
 * A pane in the rail, including which settings child.
 *
 * Lives here rather than in the component because it is persisted: the pane you
 * were on should survive the panel closing, and a store that owns the value can
 * validate what it loads.
 */
export type RailPaneId =
  | "sessions"
  | "activity"
  | "tasks"
  | "agents"
  | "settings:position"
  | "settings:behaviour"
  | "settings:appearance"
  | "settings:muted"
  | "settings:setup";

const RAIL_PANE_IDS: RailPaneId[] = [
  "sessions",
  "activity",
  "tasks",
  "agents",
  "settings:position",
  "settings:behaviour",
  "settings:appearance",
  "settings:muted",
  "settings:setup",
];

/** Stored settings can be hand-edited or left over from an older build. */
export function isRailPaneId(value: unknown): value is RailPaneId {
  return typeof value === "string" && RAIL_PANE_IDS.includes(value as RailPaneId);
}

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
/** Floor on opacity, so the rail cannot be made invisible and unfindable. */
export const MIN_OPACITY = 0.3;

export function clampOpacity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(MIN_OPACITY, value));
}

/**
 * A CSS colour at the given alpha.
 *
 * `color-mix` rather than an rgba() built by hand: the ground is a theme token,
 * so its channels are not known here.
 */
export function withOpacity(color: string, opacity: number): string {
  const percent = Math.round(clampOpacity(opacity) * 100);
  return `color-mix(in srgb, ${color} ${percent}%, transparent)`;
}

function defaultSize(anchor: AnchorId, combined: boolean): [number, number] {
  // Combined mode holds the whole of Hive behind the sidebar, so the plain
  // rail's width would open it as a sliver with the session list cut off.
  if (combined) return isHorizontalAnchor(anchor) ? [1180, 560] : [760, 780];
  // Wider than the 372px this was when the panes sat behind a row of tabs: the
  // sidebar takes 150 of it, and 222px of feed is not a feed.
  return isHorizontalAnchor(anchor) ? [900, 340] : [520, 660];
}

/**
 * Which remembered size applies.
 *
 * The two modes want very different shapes on the same edge, so a size dragged
 * out for one must not become the other's size.
 */
export function sizeKey(anchor: AnchorId, combined: boolean): string {
  return combined ? `${anchor}+hive` : anchor;
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
  sizes: Partial<Record<string, [number, number]>>;
  /** Hover is faster; click avoids opening it by brushing past the edge. */
  openOn: OpenOn;
  /** Dim the rail while nothing needs the user. */
  hideWhenIdle: boolean;
  /** Panes live inside the Hive window instead of the rail's own. */
  combined: boolean;
  /**
   * Monitor index the rail is pinned to, or null to follow the cursor.
   *
   * An index rather than a name: it is what `place_rail` takes, and a display
   * arrangement that changes invalidates either. Rust ignores an out-of-range
   * pin rather than refusing to place the window.
   */
  pinnedMonitor: number | null;
  /**
   * How opaque the rail's panel and sidebar are, 0-1.
   *
   * Two settings rather than one: the sidebar is a constant, so it can afford to
   * be more solid than the content beside it, and a single slider could not
   * express that.
   */
  panelOpacity: number;
  sidebarOpacity: number;
  /**
   * The pane last looked at, restored when the rail opens again.
   *
   * Closing the rail is not the same as being finished with it — it collapses on
   * a cursor leaving. Coming back to a different pane than you left means losing
   * your place several times an hour.
   */
  lastPane: RailPaneId;
  /** The app the feed was filtered to, or null for everything. */
  lastApp: string | null;
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
  pinnedMonitor: null,
  panelOpacity: 1,
  sidebarOpacity: 1,
  lastPane: "activity",
  lastApp: null,
  mutedApps: [],
};

function load(): Persisted {
  try {
    const raw = localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const stored = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Persisted>) };
    // A pane removed in a later build, or a hand-edited file, must not leave the
    // rail rendering nothing.
    if (!isRailPaneId(stored.lastPane)) stored.lastPane = DEFAULTS.lastPane;
    return stored;
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
  setPinnedMonitor: (index: number | null) => void;
  setLastPane: (pane: RailPaneId) => void;
  setLastApp: (appId: string | null) => void;
  setPanelOpacity: (value: number) => void;
  setSidebarOpacity: (value: number) => void;
  toggleAppMuted: (appId: string) => void;
  isAppMuted: (appId: string) => boolean;
  applyRemoteSettings: (patch: Partial<Persisted>) => void;
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
      pinnedMonitor,
      panelOpacity,
      sidebarOpacity,
      lastPane,
      lastApp,
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
          pinnedMonitor,
          panelOpacity,
          sidebarOpacity,
          lastPane,
          lastApp,
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
      broadcastRailSettings({ anchor });
    },
    setOffset: (offset) => {
      set({ offset });
      persist();
      broadcastRailSettings({ offset });
    },
    setRestingForm: (restingForm) => {
      set({ restingForm });
      persist();
      broadcastRailSettings({ restingForm });
    },
    setFollowCursor: (followCursor) => {
      set({ followCursor });
      persist();
      broadcastRailSettings({ followCursor });
    },
    setOpen: (open) => set({ open }),
    setSizeForAnchor: (a, size) => {
      const key = sizeKey(a, get().combined);
      const current = get().sizes[key];
      // A placement makes the OS report the size back, so most calls here are
      // an echo of what the rail just asked for. Writing an unchanged value
      // would still hand out a new object and wake every listener.
      if (current && current[0] === size[0] && current[1] === size[1]) return;
      set({ sizes: { ...get().sizes, [key]: size } });
      persist();
    },
    forgetSizeForAnchor: (a) => {
      // Both modes' sizes for this edge: the settings row reads as "this edge",
      // not "this edge in whichever mode I happen to be in".
      const { [a]: _plain, [sizeKey(a, true)]: _combined, ...rest } = get().sizes;
      set({ sizes: rest });
      persist();
    },
    setOpenOn: (openOn) => {
      set({ openOn });
      persist();
      broadcastRailSettings({ openOn });
    },
    setLastPane: (lastPane) => {
      set({ lastPane });
      persist();
      broadcastRailSettings({ lastPane });
    },
    setLastApp: (lastApp) => {
      set({ lastApp });
      persist();
      broadcastRailSettings({ lastApp });
    },
    setPanelOpacity: (value) => {
      const panelOpacity = clampOpacity(value);
      set({ panelOpacity });
      persist();
      broadcastRailSettings({ panelOpacity });
    },
    setSidebarOpacity: (value) => {
      const sidebarOpacity = clampOpacity(value);
      set({ sidebarOpacity });
      persist();
      broadcastRailSettings({ sidebarOpacity });
    },
    setPinnedMonitor: (pinnedMonitor) => {
      set({ pinnedMonitor });
      persist();
      broadcastRailSettings({ pinnedMonitor });
    },
    setHideWhenIdle: (hideWhenIdle) => {
      set({ hideWhenIdle });
      persist();
      broadcastRailSettings({ hideWhenIdle });
    },
    setCombined: (combined) => {
      set({ combined });
      persist();
      broadcastRailSettings({ combined });
    },
    toggleAppMuted: (appId) => {
      const current = get().mutedApps;
      const mutedApps = current.includes(appId)
        ? current.filter((id) => id !== appId)
        : [...current, appId];
      set({ mutedApps });
      persist();
      broadcastRailSettings({ mutedApps });
    },
    isAppMuted: (appId) => get().mutedApps.includes(appId),
    /**
     * Apply a change that came from the other window.
     *
     * Deliberately does not broadcast: echoing it back would have the two
     * windows bouncing the same patch between them forever.
     */
    applyRemoteSettings: (patch) => {
      set(patch as Partial<RailState>);
      persist();
    },
    currentSize: () => {
      const { anchor, sizes, combined } = get();
      return sizes[sizeKey(anchor, combined)] ?? defaultSize(anchor, combined);
    },
  };
});
