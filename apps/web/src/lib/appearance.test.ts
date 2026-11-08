import { describe, expect, it } from "vitest";
import {
  APPEARANCE_SCRIPT,
  isMode,
  isPalette,
  MODE_KEY,
  PALETTE_KEY,
  parseSize,
  resolveDark,
  SIZE_KEY,
} from "./appearance";

describe("appearance settings", () => {
  it("reads a stored size, clamped, with the default for anything else", () => {
    expect(parseSize("1.15")).toBe(1.15);
    expect(parseSize("9")).toBe(1.5);
    expect(parseSize("0.1")).toBe(0.75);
    expect(parseSize("big")).toBe(1);
    expect(parseSize(null)).toBe(1);
  });

  it("knows its modes and palettes", () => {
    expect(isMode("system")).toBe(true);
    expect(isMode("sepia")).toBe(false);
    expect(isPalette("nord")).toBe(true);
    expect(isPalette("homework")).toBe(false);
  });

  it("follows the device in System mode only", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });
});

/** Runs the inline <head> script against a stand-in page, as the browser does before the first paint. */
function runScript(stored: Record<string, string>, systemDark: boolean) {
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  const root = {
    classList: { add: (c: string) => classes.add(c) },
    style: {
      setProperty: (k: string, v: string) => {
        style[k] = v;
      },
      set colorScheme(v: string) {
        style["color-scheme"] = v;
      },
    },
  };
  const window = {
    localStorage: { getItem: (k: string) => stored[k] ?? null },
    matchMedia: () => ({ matches: systemDark }),
  };
  new Function("window", "document", APPEARANCE_SCRIPT)(window, { documentElement: root });
  return { classes: [...classes].sort(), style };
}

describe("the script that applies them before the first paint", () => {
  it("does nothing beyond light, with nothing saved on a light device", () => {
    expect(runScript({}, false)).toEqual({ classes: [], style: { "color-scheme": "light" } });
  });

  it("goes dark on a dark device in System mode, the default", () => {
    expect(runScript({}, true).classes).toEqual(["dark"]);
  });

  it("applies a saved mode, palette and size", () => {
    const out = runScript({ [MODE_KEY]: "dark", [PALETTE_KEY]: "nord", [SIZE_KEY]: "1.3" }, false);
    expect(out.classes).toEqual(["dark", "theme-nord"]);
    expect(out.style).toEqual({ "color-scheme": "dark", "--font-scale": "1.3" });
  });

  it("ignores values it doesn't know, and clamps the size", () => {
    const out = runScript(
      { [MODE_KEY]: "sepia", [PALETTE_KEY]: "constructor", [SIZE_KEY]: "5" },
      false,
    );
    expect(out.classes).toEqual([]);
    expect(out.style["--font-scale"]).toBe("1.5");
  });
});
