import { useMemo, useRef, useState } from "react";
import type { BatchStats, PinState } from "@/hooks/use-simulation-store";
import { clsx } from "clsx";

interface PinMonitorProps {
  pinStates: PinState[];
  batchStats?: BatchStats;
}

const PWM_ALPHA = 0.2; // smoothing factor

export function PinMonitor({ pinStates, batchStats }: PinMonitorProps) {
  const [showPerf, setShowPerf] = useState(false);
  const pwmAveragesRef = useRef<Map<number, number>>(new Map());

  const displayStates = useMemo(() => {
    const sorted = [...pinStates].sort((a, b) => a.pin - b.pin);
    const next = sorted.map((state) => {
      if (state.type !== "pwm") {
        return { ...state, displayValue: state.value };
      }

      const prevAvg = pwmAveragesRef.current.get(state.pin) ?? state.value;
      const smoothed = prevAvg + PWM_ALPHA * (state.value - prevAvg);
      pwmAveragesRef.current.set(state.pin, smoothed);

      return { ...state, displayValue: smoothed };
    });

    return next;
  }, [pinStates]);

  return (
    <div
      className="w-full rounded-lg border border-border bg-card p-3"
      data-testid="pin-monitor"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-ui-sm font-semibold text-foreground">Pin Monitor</div>
        <button
          type="button"
          className="text-ui-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowPerf((prev) => !prev)}
        >
          {showPerf ? "Hide FPS" : "Show FPS"}
        </button>
      </div>

      {showPerf && batchStats && (
        <div className="mb-2 text-xs text-muted-foreground">
          <div>Batch ms: {batchStats.lastBatchMs.toFixed(2)}</div>
          <div>Last batch size: {batchStats.lastBatchSize}</div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {displayStates.map((state) => {
          const isHigh = state.type !== "pwm" && state.value > 0;
          const isPwm = state.type === "pwm";
          const displayValue = isPwm
            ? Math.round(state.displayValue)
            : state.value > 0
              ? "HIGH"
              : "LOW";

          return (
            <div
              key={state.pin}
              data-pin={state.pin}
              className={clsx(
                "flex items-center justify-between rounded-md border px-2 py-1 text-ui-xs",
                isHigh && !isPwm
                  ? "border-green-400 text-green-500"
                  : "border-border text-muted-foreground",
              )}
            >
              <span>Pin {state.pin}</span>
              <span
                className={clsx(
                  "font-mono",
                  isPwm && "text-amber-500",
                )}
                data-value
              >
                {displayValue}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
