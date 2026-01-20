import { useEffect, useRef, useState, useCallback } from 'react';
import { wsMessageSchema, type WSMessage } from '@shared/schema';
import { Logger } from '@shared/logger';
const logger = new Logger('WebSocketHook');

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [messageQueue, setMessageQueue] = useState<WSMessage[]>([]);
  const [hasEverConnected, setHasEverConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = () => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        logger.info('WebSocket connected');
        setIsConnected(true);
        setHasEverConnected(true);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on success
      };

      ws.onmessage = (event) => {
        try {
          const rawData = JSON.parse(event.data);
          logger.debug(`[WS HOOK] Raw message received: ${rawData.type} ${JSON.stringify(rawData)}`);
          const data = wsMessageSchema.parse(rawData);
          // Add to queue instead of replacing
          setMessageQueue(prev => [...prev, data]);
          setLastMessage(data);
        } catch (error) {
          logger.error(`[WS HOOK] Invalid WebSocket message: ${error} Raw: ${event.data}`);
        }
      };

      ws.onclose = () => {
        logger.info('WebSocket disconnected');
        setIsConnected(false);
        setConnectionError('WebSocket disconnected. Reconnecting...');
        // Attempt to reconnect
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        logger.error(`WebSocket error: ${error}`);
        setIsConnected(false);
        setConnectionError('WebSocket error. Backend may be unreachable.');
        scheduleReconnect();
      };
    } catch (error) {
      logger.error(`Failed to create WebSocket: ${error}`);
      setIsConnected(false);
      setConnectionError('Cannot establish WebSocket. Backend unreachable.');
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (reconnectAttemptsRef.current < 5) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
      reconnectAttemptsRef.current += 1;
      
      logger.info(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    }
  };

  useEffect(() => {
    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const sendMessage = (message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      logger.warn(`WebSocket is not open. Message not sent: ${JSON.stringify(message)}`);
    }
  };

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
    hasEverConnected,
    connectionError,
  };
}
