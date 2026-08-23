import { APP_ICONS } from "./appIcons.generated";

export type AppIconSpec =
  | { kind: "brand"; hex: string; path: string }
  | { kind: "monogram"; text: string; hue: number };

/** Agents choose their own slugs, so "GitHub", "github" and "git-hub" must all hit. */
function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A hue derived from the name, so an app is the same colour on every machine
 * and after every restart. A random palette would reshuffle the apps bar's
 * colours on each launch, which reads as a bug rather than as decoration.
 */
export function monogramHue(name: string): number {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}

function monogramText(source: string): string {
  const letters = source.replace(/[^a-zA-Z]/g, "");
  // "---" with label "___" still has to render something.
  return (letters.slice(0, 2) || "?").toUpperCase();
}

export function resolveAppIcon(slug: string, label?: string): AppIconSpec {
  const brand = APP_ICONS[normalise(slug)];
  if (brand) {
    return { kind: "brand", hex: brand.hex, path: brand.path };
  }
  const source = label?.trim() || slug;
  return { kind: "monogram", text: monogramText(source), hue: monogramHue(source) };
}
