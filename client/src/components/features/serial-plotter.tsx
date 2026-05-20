import React, { useMemo, useState, useCallback } from "react";
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
import type { Props as LegendProps } from "recharts/types/component/DefaultLegendContent";
import type { OutputLine } from "@shared/schema";

/** Default palette mirrors the --plot-N CSS variables in index.css */
const DEFAULT_COLORS = [
  "#3b82f6", // --plot-1 blue
  "#ef4444", // --plot-2 red
  "#10b981", // --plot-3 green
  "#f59e0b", // --plot-4 amber
  "#8b5cf6", // --plot-5 purple
  "#ec4899", // --plot-6 pink
  "#06b6d4", // --plot-7 cyan
  "#f97316", // --plot-8 orange
];

interface SerialPlotterProps {
  readonly output: OutputLine[];
}

export const SerialPlotter: React.FC<SerialPlotterProps> = ({ output }) => {
  const [customColors, setCustomColors] = useState<Record<string, string>>({});
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
        const namedMatch = /^(.+):(-?\d+(?:\.\d+)?)$/.exec(part);
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
          const match = /^-?\d+(?:\.\d+)?$/.exec(part);
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

  const handleColorChange = useCallback(
    (key: string, color: string) => {
      setCustomColors((prev) => ({ ...prev, [key]: color }));
    },
    [],
  );

  /**
   * Custom legend: each item shows a colored swatch + series name.
   * Clicking / activating the label opens a native color picker so the user
   * can change the line color for that series.
   */
  const renderLegend = useCallback(
    (props: LegendProps) => {
      const { payload } = props;
      if (!payload?.length) return null;
      return (
        <div className="flex flex-wrap gap-3 justify-center mt-1 px-2">
          {payload.map((entry) => {
            const key = String(entry.dataKey ?? "");
            const color = customColors[key] ?? (entry.color as string);
            return (
              <label
                key={key}
                className="flex items-center gap-1.5 cursor-pointer select-none group"
                title="Klicken zum Ändern der Farbe"
              >
                <span
                  className="inline-block w-3 h-3 rounded-sm ring-1 ring-inset ring-white/20 group-hover:ring-white/60 transition-shadow shrink-0"
                  style={{ background: color }}
                />
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {entry.value}
                </span>
                {/* visually hidden color input; clicking the label triggers it */}
                <input
                  type="color"
                  className="sr-only"
                  value={color}
                  onChange={(e) => handleColorChange(key, e.target.value)}
                />
              </label>
            );
          })}
        </div>
      );
    },
    [customColors, handleColorChange],
  );

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
              tick={{ className: 'text-ui-xs text-muted-foreground' }}
            />
            <YAxis stroke="rgba(100,100,100,0.5)" tick={{ className: 'text-ui-xs text-muted-foreground' }} />
            <Tooltip
              formatter={(value) => [
                typeof value === "number" ? value.toFixed(2) : value,
                "",
              ]}
            />
            <Legend content={renderLegend} />
            {seriesKeys.map((key, idx) => {
              // Extract the stable index from the internal key
              const match = /^series_(\d+)_\d+$/.exec(key);
              const stableIndex = match ? Number(match[1]) : null;

              // Get display name from the map
              const displayName =
                stableIndex !== null && seriesNames.has(stableIndex)
                  ? seriesNames.get(stableIndex)!
                  : key;

              // Resolve color: user-chosen override first, then default palette
              const defaultColor = DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
              const color = customColors[key] ?? defaultColor;

              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
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
