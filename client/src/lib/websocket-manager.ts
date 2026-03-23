/**
 * WebSocket Singleton Manager
 * 
 * Ensures exactly ONE WebSocket connection exists across the entire application.
 * Key features:
 * - Global singleton pattern (module-level instance)
 * - Message buffering with configurable flush interval
 * - Exponential backoff reconnection
 * - Event-based architecture for React integration
 * - Cloudflare Tunnel compatible (standard WebSocket protocol)
 * 
 * CRITICAL: ws.send() NEVER creates a new WebSocket
 * CRITICAL: Only 1 connection → many messages
 */

import { Logger } from "@shared/logger";
import type { WSMessage } from "@shared/schema";
import { isArduinoMessage } from "@/types/websocket";

const logger = new Logger("WebSocketManager");

// Connection states for external consumers
export type ConnectionState = "connecting" | "connected" | "disconnected" | "reconnecting";

// Event types emitted by the manager
interface WSManagerEvents {
  stateChange: (state: ConnectionState) => void;
  message: (data: WSMessage) => void;
  error: (error: string) => void;
}

// Configuration
const CONFIG = {
  // Message buffer settings
  BUFFER_FLUSH_INTERVAL_MS: 30, // Collect messages for 30ms before sending
  MAX_BUFFER_SIZE: 100,         // Force flush if buffer exceeds this
  
  // Reconnection settings
  RECONNECT_BASE_DELAY_MS: 1000,
  RECONNECT_MAX_DELAY_MS: 30000,
  RECONNECT_MAX_ATTEMPTS: 10,
  
  // Connection settings
  CONNECTION_TIMEOUT_MS: 5000,
} as const;

class WebSocketManager {
  private static instance: WebSocketManager | null = null;
  
  private ws: WebSocket | null = null;
  private state: ConnectionState = "disconnected";
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Message buffer for batching
  private messageBuffer: WSMessage[] = [];
  private bufferFlushTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Event listeners
  private readonly listeners: Map<keyof WSManagerEvents, Set<Function>> = new Map();
  
  // Prevent duplicate connection attempts
  private isConnecting = false;
  
  // Track if we ever successfully connected (for UI messaging)
  private _hasEverConnected = false;
  
  // Test isolation: unique ID for E2E tests
  private testRunId: string | null = null;
  
  private constructor() {
    // Private constructor for singleton
    logger.info("WebSocketManager instance created");
  }
  
  /**
   * Get the singleton instance
   */
  public static getInstance(): WebSocketManager {
    WebSocketManager.instance ??= new WebSocketManager();
    return WebSocketManager.instance;
  }
  
  /**
   * Set testRunId for E2E test isolation (test-only feature)
   * Call this before connect() to associate this connection with a specific test
   */
  public setTestRunId(id: string): void {
    this.testRunId = id;
    logger.debug(`[Test Isolation] testRunId set: ${id}`);
  }
  
  /**
   * Clear testRunId (called when E2E test resets)
   */
  public clearTestRunId(): void {
    this.testRunId = null;
    logger.debug(`[Test Isolation] testRunId cleared`);
  }
  
  /**
   * Initialize and connect WebSocket
   * Safe to call multiple times - will not create duplicate connections
   */
  public connect(): void {
    // Guard: Already connected or connecting
    if (this.ws?.readyState === WebSocket.OPEN) {
      logger.debug("Already connected, skipping connect()");
      return;
    }
    
    if (this.isConnecting) {
      logger.debug("Connection already in progress, skipping connect()");
      return;
    }
    
    // Guard: WebSocket in CONNECTING state
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      logger.debug("WebSocket already connecting, skipping");
      return;
    }
    
    this.isConnecting = true;
    this.setState("connecting");
    
    // Clean up any existing connection
    this.cleanupConnection();
    
    const protocol = globalThis.location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${protocol}//${globalThis.location.host}/ws`;
    
    // Check for testRunId from sessionStorage (E2E test isolation)
    // or use previously set testRunId
    if (!this.testRunId && globalThis.window !== undefined) {
      try {
        const storedTestRunId = globalThis.sessionStorage?.getItem("__TEST_RUN_ID__");
        if (storedTestRunId) {
          this.testRunId = storedTestRunId;
          logger.debug(`[Test Isolation] Loaded testRunId from sessionStorage: ${this.testRunId}`);
        }
      } catch (err) {
        logger.debug(`Could not read sessionStorage: ${err}`);
      }
    }
    
    // Add testRunId query param for E2E test isolation
    if (this.testRunId) {
      wsUrl += `?testRunId=${encodeURIComponent(this.testRunId)}`;
    }
    
    const testRunSuffix = this.testRunId ? ` [testRunId: ${this.testRunId}]` : "";
    logger.info(`Connecting to WebSocket: ${wsUrl}${testRunSuffix}`);
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      // Set connection timeout
      this.connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState === WebSocket.CONNECTING) {
          logger.warn("Connection timeout - closing socket");
          this.ws.close();
          this.handleConnectionFailure("Connection timeout");
        }
      }, CONFIG.CONNECTION_TIMEOUT_MS);
      
      this.ws.onopen = this.handleOpen.bind(this);
      this.ws.onmessage = this.handleMessage.bind(this);
      this.ws.onclose = this.handleClose.bind(this);
      this.ws.onerror = this.handleError.bind(this);
      
    } catch (error) {
      logger.error(`Failed to create WebSocket: ${error}`);
      this.handleConnectionFailure(`Failed to create WebSocket: ${error}`);
    }
  }
  
  /**
   * Send a message through the WebSocket
   * Messages are buffered and sent in batches for efficiency
   */
  public send(message: WSMessage): boolean {
    // CRITICAL: Never create new WebSocket in send()
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send - WebSocket not open (state: ${this.ws?.readyState}). Message dropped: ${message.type}`);
      return false;
    }
    
    // Add to buffer
    this.messageBuffer.push(message);
    
    // Force flush if buffer is full
    if (this.messageBuffer.length >= CONFIG.MAX_BUFFER_SIZE) {
      this.flushBuffer();
      return true;
    }
    
    // Schedule flush if not already scheduled
    this.bufferFlushTimeout ??= setTimeout(() => {
      this.flushBuffer();
    }, CONFIG.BUFFER_FLUSH_INTERVAL_MS);
    
    return true;
  }
  
  /**
   * Send immediately without buffering (for critical messages)
   */
  public sendImmediate(message: WSMessage): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot send immediate - WebSocket not open. Message: ${message.type}`);
      return false;
    }
    
    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      logger.error(`Failed to send message: ${error}`);
      return false;
    }
  }
  
  /**
   * Flush the message buffer
   */
  private flushBuffer(): void {
    if (this.bufferFlushTimeout) {
      clearTimeout(this.bufferFlushTimeout);
      this.bufferFlushTimeout = null;
    }
    
    if (this.messageBuffer.length === 0) return;
    
    if (this.ws?.readyState !== WebSocket.OPEN) {
      logger.warn(`Cannot flush buffer - WebSocket not open. ${this.messageBuffer.length} messages dropped.`);
      this.messageBuffer = [];
      return;
    }
    
    // Send each message individually (server expects individual messages)
    // But we batch the sends in one synchronous block
    const messages = [...this.messageBuffer];
    this.messageBuffer = [];
    
    for (const msg of messages) {
      try {
        this.ws.send(JSON.stringify(msg));
      } catch (error) {
        logger.error(`Failed to send buffered message: ${error}`);
      }
    }
    
    if (messages.length > 1) {
      logger.debug(`Flushed ${messages.length} buffered messages`);
    }
  }
  
  /**
   * Gracefully disconnect
   */
  public disconnect(): void {
    logger.info("Disconnecting WebSocket");
    this.cancelReconnect();
    this.cleanupConnection();
    this.setState("disconnected");
  }
  
  /**
   * Subscribe to events
   */
  public on<K extends keyof WSManagerEvents>(event: K, callback: WSManagerEvents[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    
    // Return unsubscribe function
    return () => {
      this.listeners.get(event)?.delete(callback);
    };
  }
  
  /**
   * Get current connection state
   */
  public getState(): ConnectionState {
    return this.state;
  }
  
  /**
   * Check if connected
   */
  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  
  /**
   * Check if ever successfully connected
   */
  public hasEverConnected(): boolean {
    return this._hasEverConnected;
  }
  
  // --- Private methods ---
  
  private handleOpen(): void {
    this.isConnecting = false;
    this.clearConnectionTimeout();
    this.reconnectAttempts = 0;
    this._hasEverConnected = true;
    
    logger.info("WebSocket connected successfully");
    this.setState("connected");
  }
  
  private handleMessage(event: MessageEvent): void {
    try {
      const raw = JSON.parse(event.data);
      if (!isArduinoMessage(raw)) {
        logger.error(`Invalid WebSocket message schema: ${JSON.stringify(raw)}`);
        return;
      }

      this.emit("message", raw);
    } catch (error) {
      logger.error(`Invalid WebSocket message: ${error}. Raw: ${event.data}`);
    }
  }
  
  private handleClose(event: CloseEvent): void {
    this.isConnecting = false;
    this.clearConnectionTimeout();
    
    // Code 1001 is normal closure - log at DEBUG level, others at INFO
    const logLevel = event.code === 1001 ? 'debug' : 'info';
    logger[logLevel](`WebSocket closed: code=${event.code}, reason=${event.reason || "none"}`);
    
    // Only reconnect if we didn't explicitly disconnect
    if (this.state !== "disconnected") {
      this.scheduleReconnect();
    }
  }
  
  private handleError(event: Event): void {
    logger.error(`WebSocket error: ${event.type}`);
    this.emit("error", "WebSocket connection error");
  }
  
  private handleConnectionFailure(reason: string): void {
    this.isConnecting = false;
    this.clearConnectionTimeout();
    this.emit("error", reason);
    this.scheduleReconnect();
  }
  
  private scheduleReconnect(): void {
    // Guard: Don't reconnect if explicitly disconnected
    if (this.state === "disconnected") return;
    
    // Guard: Already have a reconnect scheduled
    if (this.reconnectTimeout) return;
    
    // Guard: Max attempts reached
    if (this.reconnectAttempts >= CONFIG.RECONNECT_MAX_ATTEMPTS) {
      logger.warn(`Max reconnect attempts (${CONFIG.RECONNECT_MAX_ATTEMPTS}) reached. Giving up.`);
      this.setState("disconnected");
      this.emit("error", "Max reconnection attempts reached. Please refresh the page.");
      return;
    }
    
    // Calculate delay with exponential backoff + jitter
    const baseDelay = CONFIG.RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts);
    const jitter = Math.random() * 1000; // 0-1s random jitter
    const delay = Math.min(baseDelay + jitter, CONFIG.RECONNECT_MAX_DELAY_MS);
    
    this.reconnectAttempts++;
    this.setState("reconnecting");
    
    logger.debug(`Scheduling reconnect in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${CONFIG.RECONNECT_MAX_ATTEMPTS})`);
    
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, delay);
  }
  
  private cancelReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.reconnectAttempts = 0;
  }
  
  private clearConnectionTimeout(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
  }
  
  private cleanupConnection(): void {
    // Flush any remaining buffered messages
    if (this.bufferFlushTimeout) {
      clearTimeout(this.bufferFlushTimeout);
      this.bufferFlushTimeout = null;
    }
    this.messageBuffer = [];
    
    if (this.ws) {
      // Remove all event handlers to prevent memory leaks
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      
      // Only close if not already closed/closing
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        try {
          this.ws.close(1000, "Client disconnect");
        } catch {
          // Ignore close errors
        }
      }
      
      this.ws = null;
    }
  }
  
  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      logger.debug(`State change: ${this.state} → ${newState}`);
      this.state = newState;
      this.emit("stateChange", newState);
    }
  }
  
  private emit<K extends keyof WSManagerEvents>(event: K, ...args: Parameters<WSManagerEvents[K]>): void {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          (cb as Function)(...args);
        } catch (error) {
          logger.error(`Error in event handler for ${event}: ${error}`);
        }
      });
    }
  }
}

// Export singleton getter for clean imports
export const getWebSocketManager = (): WebSocketManager => WebSocketManager.getInstance();

// Export for debugging in browser console
if (globalThis.window !== undefined) {
  (globalThis as any).__wsManager = getWebSocketManager;
}
