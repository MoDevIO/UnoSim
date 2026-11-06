import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { wsMessageSchema, type WSMessage } from "@shared/schema";
import { Logger } from "@shared/logger";
import { getWebSocketManager, type ConnectionState } from "@/lib/websocket-manager";

const logger = new Logger("WebSocketHook");

/**
 * React hook for WebSocket communication
 * 
 * IMPORTANT: This hook uses a singleton WebSocket manager.
 * Multiple components can use this hook - they all share the SAME connection.
 * 
 * Common mistakes this design prevents:
 * 1. ❌ Creating new WebSocket on every render
 * 2. ❌ Creating new WebSocket on every send()
 * 3. ❌ Multiple connections from different components
 * 4. ❌ Aggressive reconnection (we use exponential backoff)
 * 
 * How to verify in DevTools:
 * 1. Open DevTools → Network tab → WS filter
 * 2. You should see exactly ONE WebSocket connection
 * 3. All messages flow through this single connection
 * 4. Type `__wsManager().getState()` in console to check state
 */
export function useWebSocket({ receiveMessages = true }: { readonly receiveMessages?: boolean } = {}) {
  const [isConnected, setIsConnected] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  // The queue lives in a ref: consuming it must not set state. Emptying a state queue raced with
  // the appends still pending at a lower priority; React re-applied them and the same messages
  // were processed again, after a Stop in a loop until "Maximum update depth exceeded".
  const queueRef = useRef<WSMessage[]>([]);
  const [queueVersion, setQueueVersion] = useState(0);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // Track mount state to prevent state updates on unmounted components
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const manager = getWebSocketManager();
    
    // Set initial state from manager
    setIsConnected(manager.isConnected());
    setConnectionState(manager.getState());
    setHasEverConnected(manager.hasEverConnected());
    
    // Subscribe to state changes
    const unsubState = manager.on("stateChange", (state: ConnectionState) => {
      if (!isMountedRef.current) return;
      
      logger.debug(`Connection state changed: ${state}`);
      setIsConnected(state === "connected");
      setConnectionState(state);
      
      if (state === "connected") {
        setHasEverConnected(true);
        setConnectionError(null);
      } else if (state === "reconnecting") {
        setConnectionError("WebSocket disconnected. Reconnecting...");
      } else if (state === "disconnected") {
        setConnectionError("WebSocket disconnected.");
      }
    });
    
    // Subscribe to messages
    const unsubMessage = !receiveMessages ? () => {} : manager.on("message", (data: WSMessage) => {
      if (!isMountedRef.current) return;
      
      try {
        // Validate message schema
        const validated = wsMessageSchema.parse(data);
        logger.debug(`[WS HOOK] Message received: ${validated.type}`);
        
        queueRef.current.push(validated);
        setQueueVersion((version) => version + 1);
        setLastMessage(validated);
      } catch (error) {
        logger.error(`[WS HOOK] Invalid message schema: ${error}`);
      }
    });
    
    // Subscribe to errors
    const unsubError = manager.on("error", (error: string) => {
      if (!isMountedRef.current) return;
      logger.error(`[WS HOOK] Error: ${error}`);
      setConnectionError(error);
    });
    
    // Connect if not already connected
    // This is safe to call multiple times - manager handles deduplication
    manager.connect();
    
    return () => {
      isMountedRef.current = false;
      unsubState();
      unsubMessage();
      unsubError();
      // Note: We do NOT disconnect here!
      // The manager persists across component lifecycles.
      // Disconnect only happens on page unload or explicit user action.
    };
  }, [receiveMessages]);

  /**
   * Send a message through the WebSocket
   * Messages are automatically buffered (30ms) for efficiency
   * 
   * CRITICAL: This does NOT create a new WebSocket!
   */
  const sendMessage = useCallback((message: WSMessage) => {
    const manager = getWebSocketManager();
    const sent = manager.send(message);
    
    if (!sent) {
      logger.warn(`Message not sent (not connected): ${message.type}`);
    }
  }, []);
  
  /**
   * Send a message immediately without buffering
   * Use for time-critical messages like stop_simulation
   */
  const sendMessageImmediate = useCallback((message: WSMessage): boolean => {
    const manager = getWebSocketManager();
    const sent = manager.sendImmediate(message);
    
    if (!sent) {
      logger.warn(`Immediate message not sent (not connected): ${message.type}`);
    }
    return sent;
  }, []);

  // The messages queued so far; a new array whenever messages arrive (the version marks every change of the ref).
  const messageQueue = useMemo(() => [...queueRef.current], [queueVersion]);

  /** Takes every queued message out of the queue, each exactly once. */
  const consumeMessages = useCallback(() => queueRef.current.splice(0), []);

  return {
    isConnected,
    connectionState,
    lastMessage,
    messageQueue,
    consumeMessages,
    sendMessage,
    sendMessageImmediate,
    hasEverConnected,
    connectionError,
  };
}
