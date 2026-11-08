// How homestorm looks in this browser (ADR 0018): a palette, light or dark, and a size. Stored per browser in
// localStorage, as in homework: it's how one screen should look, not something to share. Applied to <html> by the
// script in the root layout before the first paint, then kept up to date by ThemeProvider.

export type Mode = "light" | "dark" | "system";
export type Palette = "default" | "solarized" | "nord" | "dracula" | "contrast";

export const MODES: readonly Mode[] = ["light", "dark", "system"];
export const PALETTES: readonly Palette[] = ["default", "solarized", "nord", "dracula", "contrast"];

export const MODE_KEY = "homestorm.appearance.mode";
export const PALETTE_KEY = "homestorm.appearance.palette";
export const SIZE_KEY = "homestorm.appearance.size";
/** Fired on window when this tab changes a setting; other tabs hear the `storage` event instead. */
export const APPEARANCE_EVENT = "homestorm-appearance";

/** The default palette is the plain :root / .dark colors in globals.css; the others add a `.theme-<name>` class. */
export const PALETTE_CLASS: Readonly<Record<Palette, string | null>> = {
  default: null,
  solarized: "theme-solarized",
  nord: "theme-nord",
  dracula: "theme-dracula",
  contrast: "theme-contrast",
};

export const PALETTE_LABEL: Readonly<Record<Palette, string>> = {
  default: "Default",
  solarized: "Solarized",
  nord: "Nord",
  dracula: "Dracula",
  contrast: "High contrast",
};

export const PALETTE_DESCRIPTION: Readonly<Record<Palette, string>> = {
  default: "Neutral grays with a blue accent. homestorm's own look.",
  solarized: "Ethan Schoonover's classic warm ochre and cyan.",
  nord: "Cool Arctic blue-gray. Calm and modern.",
  dracula: "Purple, pink and cyan. Best in dark mode.",
  contrast: "Black on white, or white on black, with strong borders.",
};

/**
 * Size scales the root font size, and everything sized in rem follows: text, spacing, icons. Not CSS `zoom`, which
 * moves the coordinate system and breaks menus positioned from the screen (homework's ADR 0013 found that).
 */
export const SIZE_MIN = 0.75;
export const SIZE_MAX = 1.5;
export const SIZE_DEFAULT = 1;
export const SIZE_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1, label: "Normal" },
  { value: 1.15, label: "Large" },
  { value: 1.3, label: "Larger" },
];

export function isMode(value: unknown): value is Mode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

/** A stored size, clamped to the allowed range; anything unreadable is the default. */
export function parseSize(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseFloat(raw) : Number.NaN;
  if (!Number.isFinite(n)) return SIZE_DEFAULT;
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, n));
}

export function sameSize(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

export function resolveDark(mode: Mode, systemDark: boolean): boolean {
  return mode === "system" ? systemDark : mode === "dark";
}

export interface Appearance {
  mode: Mode;
  palette: Palette;
  size: number;
}

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** This browser's settings; the defaults where none are saved, or storage is blocked. */
export function readAppearance(): Appearance {
  const mode = read(MODE_KEY);
  const palette = read(PALETTE_KEY);
  return {
    mode: isMode(mode) ? mode : "system",
    palette: isPalette(palette) ? palette : "default",
    size: parseSize(read(SIZE_KEY)),
  };
}

/** Saves one setting and tells this tab's ThemeProvider. Storage can be blocked: then it lasts until reload. */
export function writeAppearance(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the page still changes, it just isn't remembered.
  }
  window.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: { key, value } }));
}

export function applyAppearance(a: Appearance, systemDark: boolean): void {
  const root = document.documentElement;
  const dark = resolveDark(a.mode, systemDark);
  root.classList.toggle("dark", dark);
  for (const cls of Object.values(PALETTE_CLASS)) if (cls) root.classList.remove(cls);
  const cls = PALETTE_CLASS[a.palette];
  if (cls) root.classList.add(cls);
  root.style.setProperty("--font-scale", String(a.size));
  // Native controls and scrollbars follow.
  root.style.colorScheme = dark ? "dark" : "light";
}

/**
 * The same as readAppearance + applyAppearance, as a string for an inline <script> in <head>: it runs before the
 * first paint, so a dark-mode page never flashes white. Kept small and self-contained; it can't import anything.
 */
export const APPEARANCE_SCRIPT = `(function(){try{
var s=window.localStorage,m=s.getItem(${JSON.stringify(MODE_KEY)}),p=s.getItem(${JSON.stringify(PALETTE_KEY)}),z=parseFloat(s.getItem(${JSON.stringify(SIZE_KEY)}));
var c=${JSON.stringify(PALETTE_CLASS)},r=document.documentElement;
if(m!=="light"&&m!=="dark")m="system";
var d=m==="dark"||(m==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);
if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light";
if(p&&Object.prototype.hasOwnProperty.call(c,p)&&c[p])r.classList.add(c[p]);
if(isFinite(z))r.style.setProperty("--font-scale",String(Math.min(${SIZE_MAX},Math.max(${SIZE_MIN},z))));
}catch(e){}})();`;
