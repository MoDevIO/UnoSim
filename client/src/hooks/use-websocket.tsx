import { useEffect, useState, useCallback, useRef } from "react";
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
export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [messageQueue, setMessageQueue] = useState<WSMessage[]>([]);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  
  // Track mount state to prevent state updates on unmounted components
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    const manager = getWebSocketManager();
    
    // Set initial state from manager
    setIsConnected(manager.isConnected());
    setHasEverConnected(manager.hasEverConnected());
    
    // Subscribe to state changes
    const unsubState = manager.on("stateChange", (state: ConnectionState) => {
      if (!isMountedRef.current) return;
      
      logger.debug(`Connection state changed: ${state}`);
      setIsConnected(state === "connected");
      
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
    const unsubMessage = manager.on("message", (data: WSMessage) => {
      if (!isMountedRef.current) return;
      
      try {
        // Validate message schema
        const validated = wsMessageSchema.parse(data);
        logger.debug(`[WS HOOK] Message received: ${validated.type}`);
        
        // Add to queue instead of replacing
        setMessageQueue((prev) => [...prev, validated]);
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
  }, []);

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
  const sendMessageImmediate = useCallback((message: WSMessage) => {
    const manager = getWebSocketManager();
    const sent = manager.sendImmediate(message);
    
    if (!sent) {
      logger.warn(`Immediate message not sent (not connected): ${message.type}`);
    }
  }, []);

  // Function to consume and clear the message queue
  const consumeMessages = useCallback(() => {
    const messages = [...messageQueue];
    setMessageQueue([]);
    return messages;
  }, [messageQueue]);

  return {
    isConnected,
    lastMessage,
    messageQueue,
    consumeMessages,
    sendMessage,
    sendMessageImmediate,
    hasEverConnected,
    connectionError,
  };
}
