/**
 * Virtual Scrolling Hook for Serial Monitor
 * 
 * Renders only visible lines to prevent DOM bloat with 10,000+ lines.
 * Features:
 * - Fixed-height rows for efficient viewport calculation
 * - RequestAnimationFrame batching for smooth 60fps rendering
 * - Auto-scroll support with user override
 * - Memory-efficient (only visible DOM elements)
 */

import { useRef, useEffect, useState, useCallback } from "react";
import type { OutputLine } from "@shared/schema";

interface ProcessedLine {
  text: string;
  incomplete: boolean;
}

const ROW_HEIGHT = 21; // Approximate line height in pixels (text-ui-xs + padding)
const OVERSCAN_COUNT = 5; // Render extra lines above/below viewport for smooth scrolling

export function useVirtualScroll(
  lines: ProcessedLine[],
  containerHeight: number,
  enabled: boolean = true
) {
  const [scrollTop, setScrollTop] = useState(0);
  const rafIdRef = useRef<number | null>(null);
  const pendingScrollRef = useRef<number | null>(null);
  
  // Calculate visible range
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_COUNT);
  const visibleEnd = Math.min(
    lines.length,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN_COUNT
  );
  
  const visibleLines = enabled
    ? lines.slice(visibleStart, visibleEnd)
    : lines;
  
  const totalHeight = lines.length * ROW_HEIGHT;
  const offsetY = visibleStart * ROW_HEIGHT;
  
  // Throttled scroll handler with rAF batching
  const handleScroll = useCallback((newScrollTop: number) => {
    pendingScrollRef.current = newScrollTop;
    
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        if (pendingScrollRef.current !== null) {
          setScrollTop(pendingScrollRef.current);
          pendingScrollRef.current = null;
        }
        rafIdRef.current = null;
      });
    }
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);
  
  return {
    visibleLines,
    visibleStart,
    totalHeight,
    offsetY,
    handleScroll,
  };
}

/**
 * Request Animation Frame batching hook for output updates
 * Batches incoming serial data and updates UI at 60fps max
 */
export function useOutputBatching(
  output: OutputLine[],
  onUpdate: (processedLines: ProcessedLine[]) => void
) {
  const rafIdRef = useRef<number | null>(null);
  const pendingOutputRef = useRef<OutputLine[]>([]);
  const lastProcessedLengthRef = useRef(0);
  
  useEffect(() => {
    // Check if new data arrived
    if (output.length === lastProcessedLengthRef.current) {
      return; // No new data
    }
    
    // Store pending output
    pendingOutputRef.current = output;
    
    // Schedule rAF update if not already scheduled
    if (!rafIdRef.current) {
      rafIdRef.current = requestAnimationFrame(() => {
        const currentOutput = pendingOutputRef.current;
        
        // Process lines (simplified - actual processing happens in calling component)
        const processed: ProcessedLine[] = currentOutput.map(line => ({
          text: line.text,
          incomplete: !(line.complete ?? true),
        }));
        
        onUpdate(processed);
        lastProcessedLengthRef.current = currentOutput.length;
        rafIdRef.current = null;
      });
    }
  }, [output, onUpdate]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);
}
