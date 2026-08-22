import { useTheme } from "./hooks/useTheme";

export function Rail() {
  useTheme();
  return (
    <div
      className="h-screen w-screen overflow-hidden hub-material"
      style={{ background: "var(--hub-bg-solid, #141414)" }}
      data-testid="rail-root"
    />
  );
}
