import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

const STORAGE_KEY = "unoBoardColor";
const DEFAULT_COLOR = "#0f7391";
const TOAST_DURATION_KEY = "unoToastDuration";
const DEFAULT_TOAST_SECONDS = 1;
const DEBUG_MODE_KEY = "unoDebugMode";
const KEEP_EXAMPLES_MENU_OPEN_KEY = "unoKeepExamplesMenuOpen";
const DEFAULT_KEEP_EXAMPLES_MENU_OPEN = false;

export default function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [color, setColor] = React.useState<string>(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || DEFAULT_COLOR;
    } catch {
      return DEFAULT_COLOR;
    }
  });


  React.useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, color);
    } catch {}
    // Dispatch a custom event so the Arduino board can update itself
    const ev = new CustomEvent("arduinoColorChange", { detail: { color } });
    document.dispatchEvent(ev);
  }, [color]);

  // Debug mode toggle (experimental)
  const [debugMode, setDebugMode] = React.useState<boolean>(() => {
    try {
      return window.localStorage.getItem(DEBUG_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const setStoredDebug = (v: boolean) => {
    try {
      window.localStorage.setItem(DEBUG_MODE_KEY, v ? '1' : '0');
    } catch {}
    setDebugMode(v);
    try {
      const ev = new CustomEvent('debugModeChange', { detail: { value: v } });
      document.dispatchEvent(ev);
    } catch {}
  };

  // Keep examples menu open toggle
  const [keepExamplesMenuOpen, setKeepExamplesMenuOpen] = React.useState<boolean>(() => {
    try {
      const stored = window.localStorage.getItem(KEEP_EXAMPLES_MENU_OPEN_KEY);
      return stored === null ? DEFAULT_KEEP_EXAMPLES_MENU_OPEN : stored === '1';
    } catch {
      return DEFAULT_KEEP_EXAMPLES_MENU_OPEN;
    }
  });

  const setStoredKeepExamplesMenuOpen = (v: boolean) => {
    try {
      window.localStorage.setItem(KEEP_EXAMPLES_MENU_OPEN_KEY, v ? '1' : '0');
    } catch {}
    setKeepExamplesMenuOpen(v);
    try {
      const ev = new CustomEvent('keepExamplesMenuOpenChange', { detail: { value: v } });
      document.dispatchEvent(ev);
    } catch {}
  };


  // Prevent the hex input from automatically receiving focus when the dialog opens
  React.useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => {
      try {
        const el = document.querySelector('input[aria-label="hex color"]') as HTMLElement | null;
        el?.blur();
      } catch {}
    }, 0);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Application settings and experimental tweaks for the simulator.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Feature: Arduino color picker (affects main ArduinoUno.svg) */}
          <div className="rounded border p-3 bg-muted">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Arduino Color</div>
                <div className="text-xs text-muted-foreground">Change the main board color (applies to the primary SVG).</div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-8 rounded border" style={{ background: color }} />
                  <div className="flex flex-col">
                    <div className="text-xs">Hex</div>
                    <input
                      className="w-28 bg-transparent border rounded px-1 text-sm"
                      value={color}
                      onChange={(e) => {
                        const v = e.target.value;
                        const raw = v.startsWith('#') ? v.slice(1) : v;
                        if (/^[0-9a-fA-F]{6}$/.test(raw)) {
                          setColor(`#${raw}`);
                        } else {
                          // allow typing partial hex values without clobbering
                          setColor(v.startsWith('#') ? v : `#${v}`);
                        }
                      }}
                      aria-label="hex color"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => { setColor(DEFAULT_COLOR); }}>
                    Reset
                  </Button>
                </div>
              </div>
            </div>

            {/* Preset palette inside the same box */}
            <div className="mt-3 flex gap-2 flex-wrap">
              {[
                '#0f7391', // original teal
                '#0b5f73',
                '#0a98a8',
                '#2b6fb3',
                '#1f7a8c',
                '#245c3d',
                '#1f9d55',
                '#16a34a',
                '#22c55e',
                '#ff6b6b',
                '#ff9f1c',
                '#ffd166',
                '#f97316',
                '#fb923c',
                '#8338ec',
                '#7c3aed',
                '#2a2a2a',
                '#f4f4f5',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => setColor(s)}
                  aria-label={`preset ${s}`}
                  title={s}
                  style={{ background: s }}
                  className={`w-6 h-6 rounded ${color.toLowerCase() === s.toLowerCase() ? 'ring-2 ring-offset-1 ring-white' : 'border'}`}
                />
              ))}
            </div>
          </div>

          {/* Placeholder for future settings */}
          <div className="rounded border p-3 bg-muted">
            <div className="font-medium">Toast Duration</div>
            <div className="text-xs text-muted-foreground mb-2">Change global toast expiry (0.5s steps). Choose "Infinite" to disable auto-hide.</div>
            <ToastDurationControl />
          </div>

          {/* Debug mode (hidden by default) */}
          <div className="rounded border p-3 bg-muted">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Debug Mode</div>
                <div className="text-xs text-muted-foreground">Enable debug UI elements (status light and CLI/GCC labels).</div>
              </div>
              <div className="flex items-center">
                <Checkbox
                  checked={debugMode}
                  onCheckedChange={(v) => setStoredDebug(Boolean(v))}
                  aria-label="enable debug mode"
                />
              </div>
            </div>
          </div>

          {/* Keep examples menu open option */}
          <div className="rounded border p-3 bg-muted">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Keep Examples Menu Open</div>
                <div className="text-xs text-muted-foreground">When disabled (default), the examples menu closes after selecting an example. Enable to keep it open.</div>
              </div>
              <div className="flex items-center">
                <Checkbox
                  checked={keepExamplesMenuOpen}
                  onCheckedChange={(v) => setStoredKeepExamplesMenuOpen(Boolean(v))}
                  aria-label="keep examples menu open"
                />
              </div>
            </div>
          </div>

        </div>

        <DialogFooter className="mt-4">
          <div className="flex w-full justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <DialogClose asChild>
              <Button className="text-white hover:bg-[#16a34a]" style={{ backgroundColor: '#22c55e' }}>Done</Button>
            </DialogClose>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToastDurationControl() {
  const [sliderVal, setSliderVal] = React.useState<number>(() => {
    try {
      const v = window.localStorage.getItem(TOAST_DURATION_KEY)
      if (v === null) return DEFAULT_TOAST_SECONDS * 2 // slider steps are 0.5s, so value = seconds*2
      if (v === "infinite") return 21
      const ms = parseInt(v, 10)
      if (Number.isNaN(ms)) return DEFAULT_TOAST_SECONDS * 2
      const computed = Math.round((ms / 1000) * 2)
      if (computed < 1) return 1
      if (computed > 20) return 20
      return computed
    } catch {
      return DEFAULT_TOAST_SECONDS * 2
    }
  })

  const updateStored = (val: number) => {
    try {
      if (val === 21) {
        window.localStorage.setItem(TOAST_DURATION_KEY, "infinite")
      } else {
        const ms = Math.round((val / 2) * 1000)
        window.localStorage.setItem(TOAST_DURATION_KEY, String(ms))
      }
      // dispatch event for any listeners
      const ev = new CustomEvent("toastDurationChange", { detail: { value: val } })
      document.dispatchEvent(ev)
    } catch {}
  }

  React.useEffect(() => {
    updateStored(sliderVal)
  }, [])

  const onChange = (v: number) => {
    setSliderVal(v)
    updateStored(v)
  }

  const label = sliderVal === 21 ? "Infinite" : `${(sliderVal / 2).toFixed(1)}s`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-sm">Duration: <span className="font-medium">{label}</span></div>
        <div className="text-xs text-muted-foreground">Step: 0.5s</div>
      </div>
      <input
        type="range"
        min={1}
        max={21}
        step={1}
        value={sliderVal}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="toast duration"
      />
    </div>
  )
}
