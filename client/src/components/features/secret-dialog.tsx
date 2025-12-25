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

const STORAGE_KEY = "unoBoardColor";
const DEFAULT_COLOR = "#0f7391";

export default function SecretDialog({
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
          <DialogTitle>Secret Features</DialogTitle>
          <DialogDescription>
            Hidden tweaks for the simulator. Choose a feature below.
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

          {/* Placeholder for future secret features */}
          <div className="rounded border p-3 bg-muted">
            <div className="font-medium">More features coming...</div>
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
