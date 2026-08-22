import { resolveAppIcon } from "../icons/appIcon";

interface AppIconProps {
  slug: string;
  label?: string;
  size?: number;
}

/**
 * A brand mark where one exists, a stable monogram where it does not.
 *
 * Both paths are drawn locally — no request leaves the machine to render a
 * 13px glyph, which is why the favicon-fetch layer was rejected.
 */
export function AppIcon({ slug, label, size = 13 }: AppIconProps) {
  const icon = resolveAppIcon(slug, label);

  if (icon.kind === "brand") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path d={icon.path} fill={`#${icon.hex}`} />
      </svg>
    );
  }

  return (
    <span
      aria-hidden="true"
      style={{
        fontSize: Math.round(size * 0.62),
        fontWeight: 700,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        color: `hsl(${icon.hue} 80% 82%)`,
      }}
    >
      {icon.text}
    </span>
  );
}
