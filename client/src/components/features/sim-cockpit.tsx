import React from "react";
import clsx from "clsx";
import { useTelemetryStore } from "@/hooks/use-telemetry-store";

type SimulationStatus = "idle" | "running" | "compiling" | "stopped" | "paused";

export const SimCockpit: React.FC<{ 
  batchStats?: unknown;
  simulationStatus?: SimulationStatus;
}> = React.memo(({ simulationStatus = "idle" }) => {
  const { lastHeartbeatAt } = useTelemetryStore();

  // Show 0 values when paused or stopped
  const isSimActive = simulationStatus === "running";
  const isActive = isSimActive && lastHeartbeatAt && Date.now() - lastHeartbeatAt < 2000;

  return (
    <div className="hidden lg:flex items-center gap-6 bg-black/20 backdrop-blur-md border border-white/10 rounded-lg px-4 py-2 text-ui-xs uppercase tracking-wider font-medium shadow-2xl">
      {/* Health Indicator - Link State Only */}
      <div className="flex items-center gap-3">
        <div className="flex flex-col items-end">
          <span className="text-white/40 leading-none mb-1 text-right">Link State</span>
          <span className={clsx("text-ui-xs font-bold", isActive ? "text-emerald-400" : "text-red-500")}>
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