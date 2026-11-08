"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  type Appearance,
  MODE_KEY,
  type Mode,
  PALETTE_DESCRIPTION,
  PALETTE_KEY,
  PALETTE_LABEL,
  PALETTES,
  type Palette,
  parseSize,
  readAppearance,
  SIZE_KEY,
  SIZE_MAX,
  SIZE_MIN,
  SIZE_PRESETS,
  sameSize,
  writeAppearance,
} from "@/lib/appearance";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./section";

const MODE_OPTIONS: ReadonlyArray<{ value: Mode; label: string; icon: ReactNode }> = [
  { value: "light", label: "Light", icon: <Sun /> },
  { value: "dark", label: "Dark", icon: <Moon /> },
  { value: "system", label: "System", icon: <Monitor /> },
];

/** Each palette's light background, accent and dark background, for the swatch beside its name. */
const SWATCH: Record<Palette, [string, string, string]> = {
  default: ["oklch(1 0 0)", "oklch(0.546 0.215 262.881)", "oklch(0.145 0 0)"],
  solarized: ["oklch(0.97 0.025 90)", "oklch(0.63 0.14 235)", "oklch(0.24 0.028 220)"],
  nord: ["oklch(0.94 0.008 255)", "oklch(0.56 0.085 250)", "oklch(0.3 0.02 255)"],
  dracula: ["oklch(0.96 0.015 295)", "oklch(0.74 0.14 295)", "oklch(0.27 0.025 275)"],
  contrast: ["oklch(0.99 0 0)", "oklch(0.3 0.12 250)", "oklch(0.07 0 0)"],
};

const percent = (size: number) => Math.round(size * 100);

/**
 * Settings → Appearance (ADR 0018), after homework's: a palette, light or dark, and a size. Each change applies at once
 * and is remembered by this browser only.
 */
export function AppearanceSettings() {
  // Settings render only on the client (inside SessionGate), so localStorage is there to read.
  const [a, setA] = useState<Appearance>(readAppearance);
  const [custom, setCustom] = useState(() => String(percent(a.size)));

  function setMode(mode: Mode) {
    setA((x) => ({ ...x, mode }));
    writeAppearance(MODE_KEY, mode);
  }
  function setPalette(palette: Palette) {
    setA((x) => ({ ...x, palette }));
    writeAppearance(PALETTE_KEY, palette);
  }
  function setSize(size: number) {
    setA((x) => ({ ...x, size }));
    setCustom(String(percent(size)));
    writeAppearance(SIZE_KEY, String(size));
  }
  function commitCustom() {
    const pct = Number.parseFloat(custom);
    if (!Number.isFinite(pct)) return setCustom(String(percent(a.size)));
    setSize(parseSize(String(pct / 100)));
  }

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Palette"
        description="The colors of the whole app. Each has a light and a dark version."
        card={false}
      >
        <div
          role="radiogroup"
          aria-label="Palette"
          className="divide-y rounded-lg border bg-card shadow-xs"
        >
          {PALETTES.map((p) => {
            const active = p === a.palette;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a styled row, announced as a radio.
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setPalette(p)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg",
                  active ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <span className="flex shrink-0 -space-x-1.5" aria-hidden>
                  {SWATCH[p].map((color) => (
                    <span
                      key={color}
                      className="size-4 rounded-full border border-foreground/20"
                      style={{ background: color }}
                    />
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm", active && "font-medium")}>
                    {PALETTE_LABEL[p]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {PALETTE_DESCRIPTION[p]}
                  </span>
                </span>
                {active && <Check className="size-4 shrink-0 text-brand" aria-hidden />}
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Mode"
        description="System follows your device's light or dark setting, and switches when it does."
        card={false}
      >
        <Segmented
          label="Mode"
          options={MODE_OPTIONS.map((o) => ({ ...o, active: a.mode === o.value }))}
          onPick={(v) => setMode(v as Mode)}
        />
      </SettingsSection>

      <SettingsSection
        title="Size"
        description="Scales text, icons and spacing together. Pick a size, or type a percentage."
        card={false}
      >
        <div className="space-y-3">
          <Segmented
            label="Size"
            options={SIZE_PRESETS.map((p) => ({
              value: String(p.value),
              label: `${p.label} · ${percent(p.value)}%`,
              active: sameSize(a.size, p.value),
            }))}
            onPick={(v) => setSize(Number(v))}
          />
          <div className="flex items-center gap-2 text-sm">
            <label htmlFor="size-custom" className="text-muted-foreground">
              Custom
            </label>
            <input
              id="size-custom"
              type="number"
              inputMode="numeric"
              min={percent(SIZE_MIN)}
              max={percent(SIZE_MAX)}
              step={5}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitCustom();
                }
              }}
              className="h-8 w-20 rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            <span className="text-xs text-muted-foreground">
              % ({percent(SIZE_MIN)}–{percent(SIZE_MAX)}; Enter applies)
            </span>
          </div>
        </div>
      </SettingsSection>
    </div>
  );
}

/** A row of toggle buttons where one is on. */
function Segmented({
  label,
  options,
  onPick,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string; icon?: ReactNode; active: boolean }>;
  onPick: (value: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1 shadow-xs"
    >
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: a styled toggle, announced as a radio.
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.active}
          onClick={() => onPick(o.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors [&_svg]:size-3.5",
            o.active
              ? "bg-accent font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
