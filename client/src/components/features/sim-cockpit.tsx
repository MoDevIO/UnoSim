import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";
import type { BatchStats } from "@/hooks/use-simulation-store";

type SimulationStatus = "idle" | "running" | "compiling" | "stopped" | "paused";

const formatValue = (value: number) => {
  if (!Number.isFinite(value)) return "--";
  if (value >= 10000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 1000) return `${(value / 1000).toFixed(2)}k`;
  return value.toFixed(0);
};

// Hilfskomponente für kleine Trend-Graphen
const Sparkline = ({ data }: { data: number[] }) => {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * 40},${15 - (v / max) * 15}`)
    .join(" ");
  return (
    <svg className="w-10 h-4 stroke-current fill-none opacity-50" viewBox="0 0 40 15">
      <polyline points={points} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
};

export const SimCockpit: React.FC<{ 
  batchStats?: BatchStats | null;
  simulationStatus?: SimulationStatus;
}> = React.memo(({ batchStats, simulationStatus = "idle" }) => {
  const { last, lastHeartbeatAt } = useTelemetryStore();
  const [refreshHz, setRefreshHz] = React.useState(0);
  const [epsHistory, setEpsHistory] = React.useState<number[]>([]);
  const deltasRef = React.useRef<number[]>([]);
  const lastFrameAtRef = React.useRef<number | null>(null);

  // Show 0 values when paused or stopped
  const isSimActive = simulationStatus === "running";
  const eps = isSimActive ? (last?.eventsPerSecond ?? 0) : 0;
  const isActive = isSimActive && lastHeartbeatAt && Date.now() - lastHeartbeatAt < 2000;

  // EPS Historie für den Graphen
  React.useEffect(() => {
    if (eps > 0) {
      setEpsHistory(prev => [...prev.slice(-19), eps]);
    }
  }, [eps]);

  // Clear history when simulation stops
  React.useEffect(() => {
    if (simulationStatus === "stopped" || simulationStatus === "idle") {
      setEpsHistory([]);
      deltasRef.current = [];
      lastFrameAtRef.current = null;
      setRefreshHz(0);
    }
  }, [simulationStatus]);

  // UI Hz Berechnung - only when running
  React.useEffect(() => {
    if (!isSimActive) {
      setRefreshHz(0);
      return;
    }
    const currentFrameAt = batchStats?.lastFrameAt ?? 0;
    if (!currentFrameAt) return;
    const previousFrameAt = lastFrameAtRef.current;
    if (previousFrameAt && currentFrameAt > previousFrameAt) {
      const currentDelta = currentFrameAt - previousFrameAt;
      deltasRef.current = [...deltasRef.current.slice(-9), currentDelta];
      const avgDelta = deltasRef.current.reduce((a, b) => a + b, 0) / deltasRef.current.length;
      setRefreshHz(1000 / avgDelta);
    }
    lastFrameAtRef.current = currentFrameAt;
  }, [batchStats?.lastFrameAt, isSimActive]);

  return (
    <div className="hidden lg:flex items-center gap-6 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-4 py-2 text-[10px] uppercase tracking-wider font-medium shadow-2xl">
      {/* EPS Section */}
      <div className="flex items-center gap-3 border-r border-white/10 pr-4">
        <div className="flex flex-col">
          <span className="text-white/40 leading-none mb-1">Throughput</span>
          <div className="flex items-baseline gap-1">
            <span className={clsx("text-sm font-mono font-bold leading-none", 
              eps > 7000 ? "text-red-400" : eps > 2000 ? "text-amber-400" : "text-emerald-400")}>
              {formatValue(eps)}
            </span>
            <span className="text-[8px] text-white/30">EPS</span>
          </div>
        </div>
        <div className={eps > 7000 ? "text-red-400" : "text-emerald-400"}>
          <Sparkline data={epsHistory} />
        </div>
      </div>

      {/* Sync Section */}
      <div className="flex flex-col border-r border-white/10 pr-4">
        <span className="text-white/40 leading-none mb-1">UI Refresh</span>
        <div className="flex items-baseline gap-1">
          <span className="text-sm font-mono font-bold text-white/90 leading-none">
            {isActive ? refreshHz.toFixed(1) : "0.0"}
          </span>
          <span className="text-[8px] text-white/30">Hz</span>
        </div>
      </div>

      {/* Health Indicator */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-white/40 leading-none mb-1 text-right">Link State</span>
          <span className={clsx("text-[9px] font-bold", isActive ? "text-emerald-400" : "text-red-500")}>
            {isActive ? "STABLE" : "DISCONNECTED"}
          </span>
        </div>
        <div className="relative flex h-3 w-3">
          {isActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          )}
          <span className={clsx("relative inline-flex rounded-full h-3 w-3", isActive ? "bg-emerald-500" : "bg-red-600")}></span>
        </div>
      </div>
    </div>
  );
});

SimCockpit.displayName = "SimCockpit";