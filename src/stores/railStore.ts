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

export const RAIL_STORAGE_KEY = "claude-hive-rail";

const HORIZONTAL: AnchorId[] = ["top", "bottom"];

/** A rail on a horizontal edge is wide; on a vertical edge it is tall. */
function defaultSize(anchor: AnchorId): [number, number] {
  return HORIZONTAL.includes(anchor) ? [820, 280] : [372, 620];
}

interface Persisted {
  anchor: AnchorId;
  offset: number;
  restingForm: RestingForm;
  followCursor: boolean;
  sizes: Partial<Record<AnchorId, [number, number]>>;
}

const DEFAULTS: Persisted = {
  anchor: "right",
  offset: 8,
  restingForm: "nub",
  followCursor: true,
  sizes: {},
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
  currentSize: () => [number, number];
}

export const useRailStore = create<RailState>((set, get) => {
  const persist = () => {
    const { anchor, offset, restingForm, followCursor, sizes } = get();
    try {
      localStorage.setItem(
        RAIL_STORAGE_KEY,
        JSON.stringify({ anchor, offset, restingForm, followCursor, sizes })
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
    currentSize: () => {
      const { anchor, sizes } = get();
      return sizes[anchor] ?? defaultSize(anchor);
    },
  };
});
