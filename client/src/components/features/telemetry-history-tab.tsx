import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

const formatNumber = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(1);
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

interface MetricChartProps {
  title: string;
  description: string;
  values: number[];
  latest: number | null;
  gradientId: string;
  strokeColor: string;
  gradientColor: string;
}

const MetricChart: React.FC<MetricChartProps> = React.memo(({ 
  title, 
  description, 
  values, 
  latest, 
  gradientId, 
  strokeColor, 
  gradientColor 
}) => {
  const chartPath = React.useMemo(
    () => buildPath(values, 60, 240),
    [values],
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-ui-xs font-semibold text-foreground">{title}</h4>
          <p className="text-ui-xs text-muted-foreground">{description}</p>
        </div>
        <div className="text-ui-xs text-muted-foreground">
          Current: <span className="text-foreground font-mono">{latest !== null ? formatNumber(latest) : "--"}</span>
        </div>
      </div>
      <div className="bg-muted/40 border border-muted-foreground/20 rounded-lg p-2">
        {values.length === 0 ? (
          <div className="text-center text-ui-xs text-muted-foreground py-4">
            No data yet
          </div>
        ) : (
          <svg viewBox="0 0 240 60" className="w-full h-20">
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={gradientColor} stopOpacity="0.4" />
                <stop offset="100%" stopColor={gradientColor} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              d={chartPath}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={`${chartPath} L 240 60 L 0 60 Z`}
              fill={`url(#${gradientId})`}
              opacity={0.35}
            />
          </svg>
        )}
      </div>
    </div>
  );
});

MetricChart.displayName = "MetricChart";

interface MinMaxCardProps {
  label: string;
  minValue: number | null;
  maxValue: number | null;
  minAt: number | null;
  maxAt: number | null;
  minThreshold?: number;
  colorMin?: string;
  colorMax?: string;
}

const MinMaxCard: React.FC<MinMaxCardProps> = React.memo(({ 
  label, 
  minValue, 
  maxValue, 
  minAt, 
  maxAt,
  minThreshold = Number.POSITIVE_INFINITY,
  colorMin = "text-amber-400",
  colorMax = "text-emerald-400"
}) => {
  const hasMin = minValue !== null && minValue !== minThreshold && minValue > 0;
  const hasMax = maxValue !== null && maxValue > 0;
  
  return (
    <div className="bg-muted/30 border border-muted-foreground/20 rounded-lg p-3">
      <div className="text-ui-xs text-muted-foreground font-semibold mb-2">{label}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-ui-xs text-muted-foreground">Min</div>
          <div className={clsx("text-ui-sm font-mono", hasMin ? colorMin : "text-muted-foreground")}>
            {hasMin ? formatNumber(minValue!) : "--"}
          </div>
          <div className="text-ui-xs text-muted-foreground truncate">
            {hasMin ? formatTime(minAt) : "--"}
          </div>
        </div>
        <div>
          <div className="text-ui-xs text-muted-foreground">Max</div>
          <div className={clsx("text-ui-sm font-mono", hasMax ? colorMax : "text-muted-foreground")}>
            {hasMax ? formatNumber(maxValue!) : "--"}
          </div>
          <div className="text-ui-xs text-muted-foreground truncate">
            {hasMax ? formatTime(maxAt) : "--"}
          </div>
        </div>
      </div>
    </div>
  );
});

MinMaxCard.displayName = "MinMaxCard";

export const TelemetryHistoryTab: React.FC = React.memo(() => {
  const { history, peaks } = useTelemetryStore();

  const epsValues = React.useMemo(
    () => history.map((entry) => entry.eventsPerSecond),
    [history],
  );

  const efficiencyValues = React.useMemo(
    () => history.map((entry) => entry.batchEfficiency),
    [history],
  );

  const latest = history.length > 0 ? history[history.length - 1] : null;

  return (
    <div className="flex-1 overflow-auto p-4 space-y-4">
      <div>
        <h3 className="text-ui-sm font-semibold text-foreground">Telemetry Stats</h3>
        <p className="text-ui-xs text-muted-foreground">
          Live metrics history (last 60s)
        </p>
      </div>

      {/* EPS Chart */}
      <MetricChart
        title="Throughput (EPS)"
        description="Events per second"
        values={epsValues}
        latest={latest?.eventsPerSecond ?? null}
        gradientId="epsGradient"
        strokeColor="#22c55e"
        gradientColor="#22c55e"
      />

      {/* Efficiency Chart */}
      <MetricChart
        title="Batch Efficiency"
        description="Events per batch"
        values={efficiencyValues}
        latest={latest?.batchEfficiency ?? null}
        gradientId="efficiencyGradient"
        strokeColor="#f59e0b"
        gradientColor="#f59e0b"
      />

      {/* Min/Max Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <MinMaxCard
          label="Throughput (EPS)"
          minValue={peaks.minEventsPerSecond}
          maxValue={peaks.maxEventsPerSecond}
          minAt={peaks.minEventsAt}
          maxAt={peaks.maxEventsAt}
        />
        <MinMaxCard
          label="Batch Efficiency"
          minValue={peaks.minBatchEfficiency}
          maxValue={peaks.maxBatchEfficiency}
          minAt={peaks.minEfficiencyAt}
          maxAt={peaks.maxEfficiencyAt}
        />
      </div>
    </div>
  );
});

TelemetryHistoryTab.displayName = "TelemetryHistoryTab";
