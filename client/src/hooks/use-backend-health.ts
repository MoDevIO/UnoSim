import { useState, useEffect, useRef, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { useWebSocket } from "@/hooks/use-websocket";
import type { QueryClient } from "@tanstack/react-query";

export function useBackendHealth(queryClient: QueryClient) {
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendPingError, setBackendPingError] = useState<string | null>(null);
  const [showErrorGlitch, setShowErrorGlitch] = useState(false);

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

  // Lightweight backend ping every second
  useEffect(() => {
    let cancelled = false;

    const ping = async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 800);
      try {
        const res = await fetch("/api/health", {
          method: "GET",
          cache: "no-store",
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

    const interval = setInterval(ping, 1000);
    ping();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // WebSocket reachability notifications
  useEffect(() => {
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
  }, [connectionError, isConnected, hasEverConnected, toast]);

  // Show toast when HTTP backend becomes unreachable or recovers
  useEffect(() => {
    if (!backendReachable) {
      wasBackendUnreachableRef.current = true;
      toast({
        title: "Backend unreachable",
        description: backendPingError || "Could not reach API server.",
        variant: "destructive",
      });
    } else if (backendReachable && wasBackendUnreachableRef.current) {
      // Backend recovered after being unreachable
      wasBackendUnreachableRef.current = false;
      toast({
        title: "Backend reachable again",
        description: "Connection restored.",
      });
    }
  }, [backendReachable, backendPingError, toast]);

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
    ensureBackendConnected,
    isBackendUnreachableError,
    triggerErrorGlitch,
  };
}
