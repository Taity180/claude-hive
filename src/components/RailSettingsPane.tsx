import { invoke } from "@tauri-apps/api/core";
import { useHubStore } from "../stores/hubStore";
import { sizeKey, useRailStore, type AnchorId } from "../stores/railStore";
import { AppIcon } from "./AppIcon";

/** The 3×3 grid, reading order, with the inert centre as null. */
const ANCHOR_GRID: (AnchorId | null)[] = [
  "tl",
  "top",
  "tr",
  "left",
  null,
  "right",
  "bl",
  "bottom",
  "br",
];

const ANCHOR_NAMES: Record<AnchorId, string> = {
  tl: "Top left",
  top: "Top centre",
  tr: "Top right",
  left: "Left centre",
  right: "Right centre",
  bl: "Bottom left",
  bottom: "Bottom centre",
  br: "Bottom right",
};

const HORIZONTAL: AnchorId[] = ["top", "bottom"];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[10px] font-semibold uppercase tracking-wide px-1"
      style={{ color: "var(--hub-text-dim)" }}
    >
      {children}
    </h2>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
      style={{ background: "var(--hub-surface)" }}
    >
      {children}
    </div>
  );
}

function Label({ title, hint }: { title: string; hint?: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block text-[11.5px]" style={{ color: "var(--hub-text)" }}>
        {title}
      </span>
      {hint && (
        <span className="block text-[10px] leading-snug" style={{ color: "var(--hub-text-muted)" }}>
          {hint}
        </span>
      )}
    </span>
  );
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative shrink-0"
      style={{
        width: 32,
        height: 19,
        borderRadius: 999,
        border: 0,
        cursor: "pointer",
        background: on ? "var(--hub-accent)" : "rgba(255,255,255,0.13)",
        transition: "background 180ms",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 2,
          left: on ? 15 : 2,
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: "#fff",
          transition: "left 180ms",
          boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
        }}
      />
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <span
      className="flex items-center gap-0.5 rounded-md p-0.5 shrink-0"
      style={{ background: "rgba(0,0,0,0.24)" }}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className="text-[10.5px] rounded px-1.5 py-0.5"
          style={{
            border: 0,
            cursor: "pointer",
            fontWeight: value === option.id ? 600 : 500,
            background: value === option.id ? "var(--hub-surface)" : "transparent",
            color: value === option.id ? "var(--hub-text)" : "var(--hub-text-muted)",
          }}
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

export function RailSettingsPane() {
  const anchor = useRailStore((s) => s.anchor);
  const offset = useRailStore((s) => s.offset);
  const restingForm = useRailStore((s) => s.restingForm);
  const openOn = useRailStore((s) => s.openOn);
  const followCursor = useRailStore((s) => s.followCursor);
  const hideWhenIdle = useRailStore((s) => s.hideWhenIdle);
  const combined = useRailStore((s) => s.combined);
  const sizes = useRailStore((s) => s.sizes);
  const mutedApps = useRailStore((s) => s.mutedApps);

  const setAnchor = useRailStore((s) => s.setAnchor);
  const setOffset = useRailStore((s) => s.setOffset);
  const setRestingForm = useRailStore((s) => s.setRestingForm);
  const setOpenOn = useRailStore((s) => s.setOpenOn);
  const setFollowCursor = useRailStore((s) => s.setFollowCursor);
  const setHideWhenIdle = useRailStore((s) => s.setHideWhenIdle);
  const setCombined = useRailStore((s) => s.setCombined);
  const forgetSizeForAnchor = useRailStore((s) => s.forgetSizeForAnchor);
  const toggleAppMuted = useRailStore((s) => s.toggleAppMuted);

  const agentApps = useHubStore((s) => s.agentApps);
  // Mode-keyed: the size shown must be the one this mode will actually use.
  const remembered = sizes[sizeKey(anchor, combined)];

  // Labels for muted apps, falling back to the slug. A muted app the agent has
  // since stopped declaring must still be listed here, or the mute becomes
  // unreachable — it is no longer in the bar to right-click.
  const mutedRows = mutedApps.map((id) => ({
    id,
    label: agentApps.find((a) => a.id === id)?.label ?? id,
  }));

  return (
    <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-3">
      <section className="flex flex-col gap-1.5">
        <SectionTitle>Where it sits</SectionTitle>

        <Row>
          <Label
            title="Anchor"
            hint="Corners dodge the taskbar and Windows notification toasts."
          />
          <span
            className="shrink-0 grid"
            style={{ gridTemplateColumns: "repeat(3, 26px)", gap: 3 }}
          >
            {ANCHOR_GRID.map((id, index) =>
              id === null ? (
                <span
                  key="centre"
                  aria-hidden="true"
                  style={{
                    borderRadius: 4,
                    boxShadow: "inset 0 0 0 1px var(--hub-hair)",
                  }}
                />
              ) : (
                <button
                  key={id}
                  type="button"
                  data-testid="anchor-option"
                  data-anchor={id}
                  aria-pressed={anchor === id}
                  aria-label={ANCHOR_NAMES[id]}
                  title={ANCHOR_NAMES[id]}
                  onClick={() => setAnchor(id)}
                  className="grid place-items-center"
                  style={{
                    height: 22,
                    borderRadius: 4,
                    border: 0,
                    cursor: "pointer",
                    background: anchor === id ? "var(--hub-accent)" : "var(--hub-surface)",
                    boxShadow: anchor === id ? "none" : "inset 0 0 0 1px var(--hub-hair)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: "block",
                      width: HORIZONTAL.includes(id) ? 10 : 3,
                      height: HORIZONTAL.includes(id) ? 3 : 10,
                      borderRadius: 2,
                      background:
                        anchor === id ? "var(--hub-accent-text)" : "var(--hub-text-dim)",
                    }}
                    data-grid-index={index}
                  />
                </button>
              )
            )}
          </span>
        </Row>

        <Row>
          <Label title="Edge offset" hint="Gap from the monitor edge." />
          <span className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              aria-label="Decrease edge offset"
              // Clamped at zero: a negative offset would push the rail off the
              // screen it is anchored to.
              onClick={() => setOffset(Math.max(0, offset - 1))}
              className="grid place-items-center text-[12px]"
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                border: 0,
                cursor: "pointer",
                background: "var(--hub-surface)",
                color: "var(--hub-text)",
              }}
            >
              &minus;
            </button>
            <span
              className="text-[11px] tabular-nums text-center"
              style={{ width: 34, color: "var(--hub-text)" }}
            >
              {offset} px
            </span>
            <button
              type="button"
              aria-label="Increase edge offset"
              onClick={() => setOffset(offset + 1)}
              className="grid place-items-center text-[12px]"
              style={{
                width: 20,
                height: 20,
                borderRadius: 5,
                border: 0,
                cursor: "pointer",
                background: "var(--hub-surface)",
                color: "var(--hub-text)",
              }}
            >
              +
            </button>
          </span>
        </Row>

        <Row>
          <Label
            title="Remembered size"
            hint="Each anchor keeps its own: a side rail wants tall, a bottom one wide."
          />
          <span
            data-testid="remembered-size"
            className="text-[10.5px] tabular-nums shrink-0"
            style={{ color: "var(--hub-text-muted)" }}
          >
            {remembered ? `${remembered[0]} × ${remembered[1]}` : "Default"}
          </span>
          <button
            type="button"
            aria-label="Forget remembered size"
            onClick={() => {
              forgetSizeForAnchor(anchor);
              // Placement is no longer keyed on the remembered sizes — it
              // re-triggered itself through the resize the OS reports back — so
              // the one case that does need a fresh placement asks for it.
              const [width, height] = useRailStore.getState().currentSize();
              void invoke("place_rail", { anchor, width, height, offset }).catch((err) => {
                console.error("[hive] place_rail failed:", err);
              });
            }}
            className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
            style={{
              background: "var(--hub-surface)",
              border: 0,
              color: "var(--hub-text-muted)",
              cursor: "pointer",
            }}
          >
            Reset
          </button>
        </Row>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionTitle>Behaviour</SectionTitle>

        <Row>
          <Label title="Resting form" hint="The nub shows counts; the sliver only a dot." />
          <Segmented
            options={[
              { id: "nub" as const, label: "Nub" },
              { id: "sliver" as const, label: "Sliver" },
            ]}
            value={restingForm}
            onChange={setRestingForm}
          />
        </Row>

        <Row>
          <Label
            title="Open on"
            hint="Hover is faster; click avoids opening it by brushing past."
          />
          <Segmented
            options={[
              { id: "click" as const, label: "Click" },
              { id: "hover" as const, label: "Hover" },
            ]}
            value={openOn}
            onChange={setOpenOn}
          />
        </Row>

        <Row>
          <Label
            title="Follow my cursor"
            hint="Moves to whichever monitor the cursor is on."
          />
          <Switch label="Follow my cursor" on={followCursor} onChange={setFollowCursor} />
        </Row>

        <Row>
          <Label
            title="Hide when nothing needs you"
            hint="Dims while idle. Hovering brings it back."
          />
          <Switch
            label="Hide when nothing needs you"
            on={hideWhenIdle}
            onChange={setHideWhenIdle}
          />
        </Row>

        <Row>
          <Label
            title="Bring Hive into the rail"
            hint="One window with a sidebar. Hive's own window steps aside."
          />
          <Switch label="Bring Hive into the rail" on={combined} onChange={setCombined} />
        </Row>
      </section>

      <section className="flex flex-col gap-1.5">
        <SectionTitle>Muted apps</SectionTitle>

        {mutedRows.length === 0 && (
          <span className="text-[11px] px-2 py-1" style={{ color: "var(--hub-text-muted)" }}>
            Nothing muted. Right-click an app in the bar to keep it out of All activity.
          </span>
        )}

        {mutedRows.map((app) => (
          <Row key={app.id}>
            <span className="shrink-0">
              <AppIcon slug={app.id} label={app.label} size={12} />
            </span>
            <Label title={app.label} />
            <button
              type="button"
              aria-label={`Unmute ${app.label}`}
              onClick={() => toggleAppMuted(app.id)}
              className="shrink-0 text-[10.5px] rounded px-1.5 py-0.5"
              style={{
                background: "var(--hub-surface)",
                border: 0,
                color: "var(--hub-text-muted)",
                cursor: "pointer",
              }}
            >
              Unmute
            </button>
          </Row>
        ))}
      </section>
    </div>
  );
}
