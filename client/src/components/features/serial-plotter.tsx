import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { OutputLine } from "@shared/schema";

interface SerialPlotterProps {
  output: OutputLine[];
}

// Color palette for multiple series
const SERIES_COLORS = [
  "#3b82f6", // blue
  "#ef4444", // red
  "#10b981", // green
  "#f59e0b", // amber
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#f97316", // orange
];

export const SerialPlotter: React.FC<SerialPlotterProps> = ({ output }) => {
  const { chartData, seriesKeys, seriesNames } = useMemo(() => {
    const data: Array<{ index: number; [key: string]: number | string }> = [];
    const seriesRegistry = new Map<string, number>(); // Maps "Name" -> unique stable index
    const seriesNameMap = new Map<number, string>(); // Maps stable index -> display name
    const seriesSet = new Set<string>();
    let pointIndex = 0;
    let nextSeriesIndex = 0;

    output.forEach((ln) => {
      const text = ln.text.trim();
      if (!text) return;

      // Split by comma or tab to handle multiple values per line
      const parts = text.split(/[,\t]/);
      const dataPoint: { index: number; [key: string]: number | string } = {
        index: pointIndex,
      };
      let hasValidValue = false;
      let unnamedIndex = 0;
      const localNameCounts = new Map<string, number>(); // Count names within this line

      parts.forEach((part) => {
        part = part.trim();
        if (!part) return;

        // Check if format is "Name:Value"
        const namedMatch = part.match(/^(.+):(-?\d+(?:\.\d+)?)$/);
        if (namedMatch) {
          const baseName = namedMatch[1].trim();
          const value = Number(namedMatch[2]);

          // Count occurrences within this line
          const localCount = (localNameCounts.get(baseName) || 0) + 1;
          localNameCounts.set(baseName, localCount);

          // Get or create stable registry index for this name
          if (!seriesRegistry.has(baseName)) {
            seriesRegistry.set(baseName, nextSeriesIndex);
            seriesNameMap.set(nextSeriesIndex, baseName);
            nextSeriesIndex++;
          }
          const stableIndex = seriesRegistry.get(baseName)!;

          // Create internal key using stable index and local count (for uniqueness within line)
          const internalKey = `series_${stableIndex}_${localCount}`;
          dataPoint[internalKey] = value;
          seriesSet.add(internalKey);
          hasValidValue = true;
        } else {
          // Fallback: try to parse as plain number
          const match = part.match(/^-?\d+(?:\.\d+)?$/);
          if (match) {
            const value = Number(match[0]);
            const seriesName = `series${unnamedIndex}`;
            dataPoint[seriesName] = value;
            seriesSet.add(seriesName);
            unnamedIndex++;
            hasValidValue = true;
          }
        }
      });

      if (hasValidValue) {
        data.push(dataPoint);
        pointIndex++;
      }
    });

    return {
      chartData: data,
      seriesKeys: Array.from(seriesSet),
      seriesNames: seriesNameMap,
    };
  }, [output]);

  // Keep last 200 points for performance
  const displayData = useMemo(() => {
    return chartData.slice(-200);
  }, [chartData]);

  if (displayData.length === 0) {
    return (
      <div className="h-full flex flex-col" data-testid="serial-plotter">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-muted-foreground italic">
            No numeric data to plot.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" data-testid="serial-plotter">
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={displayData}
            margin={{ top: 5, right: 30, left: 0, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(100,100,100,0.2)"
            />
            <XAxis
              dataKey="index"
              stroke="rgba(100,100,100,0.5)"
              tick={{ fontSize: 12 }}
            />
            <YAxis stroke="rgba(100,100,100,0.5)" tick={{ fontSize: 12 }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "rgba(0,0,0,0.8)",
                border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "4px",
                color: "#ffffff",
              }}
              formatter={(value) => [
                typeof value === "number" ? value.toFixed(2) : value,
                "",
              ]}
            />
            <Legend />
            {seriesKeys.map((key, idx) => {
              // Extract the stable index from the internal key
              const match = key.match(/^series_(\d+)_\d+$/);
              const stableIndex = match ? Number(match[1]) : null;

              // Get display name from the map
              const displayName =
                stableIndex !== null && seriesNames.has(stableIndex)
                  ? seriesNames.get(stableIndex)!
                  : key;

              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={SERIES_COLORS[idx % SERIES_COLORS.length]}
                  isAnimationActive={false}
                  dot={false}
                  name={displayName}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
