import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(0);
};

const formatTime = (timestamp: number | null) => {
  if (!timestamp) return "--";
  return new Date(timestamp).toLocaleTimeString();
};

const buildPath = (values: number[], height: number, width: number) => {
  if (values.length === 0) return "";
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / span) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
};

export const TelemetryHistoryTab: React.FC = React.memo(() => {
  const { history, peaks } = useTelemetryStore();

  const chartValues = React.useMemo(
    () => history.map((entry) => entry.eventsPerSecond),
    [history],
  );

  const chartPath = React.useMemo(
    () => buildPath(chartValues, 60, 240),
    [chartValues],
  );

  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-ui-sm font-semibold text-foreground">Telemetry Stats</h3>
          <p className="text-ui-xs text-muted-foreground">
            Live history of events per second (last 60s)
          </p>
        </div>
        <div className="text-ui-xs text-muted-foreground">
          Latest: <span className="text-foreground font-mono">{latest ? formatNumber(latest.eventsPerSecond) : "--"}</span>
        </div>
      </div>

      <div className="bg-muted/40 border border-muted-foreground/20 rounded-lg p-3">
        {history.length === 0 ? (
          <div className="text-center text-ui-xs text-muted-foreground py-8">
            No telemetry data yet. Start a simulation to populate the graph.
          </div>
        ) : (
          <svg viewBox="0 0 240 60" className="w-full h-32">
            <defs>
              <linearGradient id="epsGradient" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity="0.4" />
                <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={chartPath}
              fill="none"
              stroke="#22c55e"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`${chartPath} L 240 60 L 0 60 Z`}
              fill="url(#epsGradient)"
              opacity={0.35}
            />
          </svg>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-muted/30 border border-muted-foreground/20 rounded-lg p-3">
          <div className="text-ui-xs text-muted-foreground">Peak EPS</div>
          <div className="text-ui-sm font-mono text-emerald-400">
            {peaks.maxEventsPerSecond > 0 ? formatNumber(peaks.maxEventsPerSecond) : "--"}
          </div>
          <div className="text-ui-xs text-muted-foreground">
            {formatTime(peaks.maxEventsAt)}
          </div>
        </div>
        <div className="bg-muted/30 border border-muted-foreground/20 rounded-lg p-3">
          <div className="text-ui-xs text-muted-foreground">Lowest Efficiency</div>
          <div
            className={clsx(
              "text-ui-sm font-mono",
              peaks.minBatchEfficiency !== Number.POSITIVE_INFINITY
                ? "text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {peaks.minBatchEfficiency !== Number.POSITIVE_INFINITY
              ? peaks.minBatchEfficiency.toFixed(2)
              : "--"}
          </div>
          <div className="text-ui-xs text-muted-foreground">
            {formatTime(peaks.minEfficiencyAt)}
          </div>
        </div>
      </div>
    </div>
  );
});

TelemetryHistoryTab.displayName = "TelemetryHistoryTab";
