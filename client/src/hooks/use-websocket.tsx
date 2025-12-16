import { useEffect, useRef, useState, useCallback } from 'react';
import { wsMessageSchema, type WSMessage } from '@shared/schema';

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
  const [messageQueue, setMessageQueue] = useState<WSMessage[]>([]);
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
        console.log('WebSocket connected');
        setIsConnected(true);
        reconnectAttemptsRef.current = 0; // Reset reconnect attempts on success
      };

      ws.onmessage = (event) => {
        try {
          const rawData = JSON.parse(event.data);
          console.log('[WS HOOK] Raw message received:', rawData.type, rawData);
          const data = wsMessageSchema.parse(rawData);
          // Add to queue instead of replacing
          setMessageQueue(prev => [...prev, data]);
          setLastMessage(data);
        } catch (error) {
          console.error('[WS HOOK] Invalid WebSocket message:', error, 'Raw:', event.data);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        // Attempt to reconnect
        scheduleReconnect();
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        setIsConnected(false);
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setIsConnected(false);
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (reconnectAttemptsRef.current < 5) {
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s
      const delay = Math.pow(2, reconnectAttemptsRef.current) * 1000;
      reconnectAttemptsRef.current += 1;
      
      console.log(`Scheduling WebSocket reconnect in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
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
      console.warn('WebSocket is not open. Message not sent:', message);
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
  };
}
