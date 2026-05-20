import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import type { QueryClient } from "@tanstack/react-query";
import type { ServerStatusEventData } from "@/types/external-api";

type PoolStats = ServerStatusEventData["pool"];
type CompileStats = ServerStatusEventData["compile"];

type ServerStatus = {
  pool: PoolStats;
  compile: CompileStats;
} | null;

/** Polling intervals fetched from /api/config (fallbacks match server defaults) */
interface ClientConfig {
  healthPollIntervalMs: number;
  statusPollIntervalMs: number;
  startupGraceMs: number;
  fetchTimeoutMs: number;
}

const DEFAULT_CLIENT_CONFIG: ClientConfig = {
  healthPollIntervalMs: 5_000,
  statusPollIntervalMs: 15_000,
  startupGraceMs: 5_000,
  fetchTimeoutMs: 2_000,
};

export function useBackendHealth(queryClient: QueryClient) {
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendPingError, setBackendPingError] = useState<string | null>(null);
  const [showErrorGlitch, setShowErrorGlitch] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>(null);

  // Store polling config in a ref so effect callbacks always read current values
  // without re-triggering interval setup when /api/config responds.
  const configRef = useRef<ClientConfig>(DEFAULT_CLIENT_CONFIG);

  // Fetch dynamic config from server once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/config", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) configRef.current = { ...DEFAULT_CLIENT_CONFIG, ...data };
        }
      } catch {
        // Use defaults on failure
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Startup grace period: suppress error toasts during initial connection phase.
  const [startupGraceOver, setStartupGraceOver] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStartupGraceOver(true), configRef.current.startupGraceMs);
    return () => clearTimeout(timer);
  }, []);

  // Ref to track if backend was ever unreachable (for recovery toast)
  const wasBackendUnreachableRef = useRef(false);

  // Ref to track previous backend reachable state for detecting transitions
  const prevBackendReachableRef = useRef(true);

  const { toast } = useToast();
  const { isConnected, connectionError, hasEverConnected } = useWebSocket();

  // Trigger visual glitch effect on compilation error
  const triggerErrorGlitch = useCallback((duration = 600) => {
    try {
      setShowErrorGlitch(true);
      globalThis.setTimeout(() => setShowErrorGlitch(false), duration);
    } catch {}
  }, []);

  // Lightweight backend ping
  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), configRef.current.fetchTimeoutMs);
      try {
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
          headers: { Connection: "close" },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!cancelled) {
          setBackendReachable(true);
          setBackendPingError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setBackendReachable(false);
          setBackendPingError((err as Error)?.message || "Health check failed");
        }
      } finally {
        clearTimeout(timeout);
      }
    };

    const interval = setInterval(ping, configRef.current.healthPollIntervalMs);
    ping();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Poll /api/status for pool / compile-queue stats
  useEffect(() => {
    let cancelled = false;

    const fetchStatus = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), configRef.current.fetchTimeoutMs);
      try {
        const res = await fetch("/api/status", { cache: "no-store", headers: { Connection: "close" }, signal: controller.signal });
        if (!res.ok) return;
        const data = await res.json() as { pool: PoolStats; compile: CompileStats };
        if (!cancelled) {
          setServerStatus({ pool: data.pool, compile: data.compile });
        }
      } catch {
        // status fetch failure is non-critical – silently ignore
      } finally {
        clearTimeout(timeout);
      }
    };

    const interval = setInterval(fetchStatus, configRef.current.statusPollIntervalMs);
    fetchStatus();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // WebSocket reachability notifications (suppressed during startup grace period)
  useEffect(() => {
    if (!startupGraceOver) return;
    if (connectionError) {
      toast({
        title: "Backend unreachable",
        description: connectionError,
        variant: "destructive",
      });
    } else if (!isConnected && hasEverConnected) {
      toast({
        title: "Connection lost",
        description: "Trying to re-establish backend connection...",
        variant: "destructive",
      });
    }
  }, [startupGraceOver, connectionError, isConnected, hasEverConnected, toast]);

  // Show toast when HTTP backend becomes unreachable or recovers
  // Toast display is suppressed during startup grace period, but the
  // wasBackendUnreachableRef tracking always runs so that post-grace
  // transitions are detected correctly.
  useEffect(() => {
    if (!backendReachable) {
      wasBackendUnreachableRef.current = true;
      if (startupGraceOver) {
        toast({
          title: "Backend unreachable",
          description: backendPingError || "Could not reach API server.",
          variant: "destructive",
        });
      }
    } else if (backendReachable && wasBackendUnreachableRef.current) {
      // Backend recovered after being unreachable
      wasBackendUnreachableRef.current = false;
      if (startupGraceOver) {
        toast({
          title: "Backend reachable again",
          description: "Connection restored.",
        });
      }
    }
  }, [startupGraceOver, backendReachable, backendPingError, toast]);

  // Refetch sketches when backend becomes reachable again (false -> true transition)
  useEffect(() => {
    const wasUnreachable = !prevBackendReachableRef.current;
    const isNowReachable = backendReachable;

    // Update the ref for next check
    prevBackendReachableRef.current = backendReachable;

    if (wasUnreachable && isNowReachable) {
      // Backend just transitioned from unreachable to reachable
      queryClient.refetchQueries({ queryKey: ["/api/sketches"] });
    }
  }, [backendReachable, queryClient]);

  const ensureBackendConnected = useCallback(
    (actionLabel: string) => {
      if (!backendReachable || !isConnected) {
        toast({
          title: "Backend unreachable",
          description:
            backendPingError ||
            connectionError ||
            `${actionLabel} failed because the backend is not reachable. Please check the server or retry in a moment.`,
          variant: "destructive",
        });
        return false;
      }
      return true;
    },
    [backendReachable, isConnected, backendPingError, connectionError, toast],
  );

  const isBackendUnreachableError = useCallback((error: unknown) => {
    const message = (error as Error | undefined)?.message || "";
    return (
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("ERR_CONNECTION") ||
      message.includes("Network request failed")
    );
  }, []);

  return {
    backendReachable,
    backendPingError,
    showErrorGlitch,
    serverStatus,
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
  };
}
