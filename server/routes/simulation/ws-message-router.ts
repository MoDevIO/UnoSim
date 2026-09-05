import type { RawData, WebSocket } from "ws";
import type { Logger } from "@shared/logger";
import type { ClientToServerWSMessage } from "@shared/schema";
import { decodeClientMessage } from "../../services/ws-message-decoder";
import type { ClientState } from "./ws-session-manager";

function rawDataToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString();
  return data.toString();
}

type MessageHandler<T extends ClientToServerWSMessage> = (
  ws: WebSocket,
  data: T,
  clientState: ClientState,
) => void | Promise<void>;

export interface WsMessageRouterHandlers {
  startSimulation: MessageHandler<Extract<ClientToServerWSMessage, { type: "start_simulation" }>>;
  codeChanged: MessageHandler<Extract<ClientToServerWSMessage, { type: "code_changed" }>>;
  stopSimulation: MessageHandler<Extract<ClientToServerWSMessage, { type: "stop_simulation" }>>;
  pauseSimulation: MessageHandler<Extract<ClientToServerWSMessage, { type: "pause_simulation" }>>;
  resumeSimulation: MessageHandler<Extract<ClientToServerWSMessage, { type: "resume_simulation" }>>;
  serialInput: MessageHandler<Extract<ClientToServerWSMessage, { type: "serial_input" }>>;
  setPinValue: MessageHandler<Extract<ClientToServerWSMessage, { type: "set_pin_value" }>>;
}

interface WsMessageRouterParams {
  logger: Logger;
  getClientState: (ws: WebSocket) => ClientState | undefined;
  handlers: WsMessageRouterHandlers;
}

export class WsMessageRouter {
  constructor(private readonly params: WsMessageRouterParams) {}

  async route(ws: WebSocket, message: RawData): Promise<void> {
    try {
      const msgText = rawDataToString(message);
      this.params.logger.debug(`[WS-IN] ${msgText}`);
      const data = decodeClientMessage(msgText);
      if (!data) {
        this.params.logger.warn("[WS] Rejected invalid client message");
        ws.close(1008, "Invalid message");
        return;
      }

      const clientState = this.params.getClientState(ws);
      if (!clientState) {
        this.params.logger.warn(
          `[WS] Message received but clientState not found for type: ${data.type}`,
        );
        return;
      }

      await this.dispatch(ws, data, clientState);
    } catch (error) {
      this.params.logger.error(
        `Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async dispatch(
    ws: WebSocket,
    data: ClientToServerWSMessage,
    clientState: ClientState,
  ): Promise<void> {
    switch (data.type) {
      case "start_simulation":
        await this.params.handlers.startSimulation(ws, data, clientState);
        break;
      case "code_changed":
        await this.params.handlers.codeChanged(ws, data, clientState);
        break;
      case "stop_simulation":
        await this.params.handlers.stopSimulation(ws, data, clientState);
        break;
      case "pause_simulation":
        await this.params.handlers.pauseSimulation(ws, data, clientState);
        break;
      case "resume_simulation":
        await this.params.handlers.resumeSimulation(ws, data, clientState);
        break;
      case "serial_input":
        await this.params.handlers.serialInput(ws, data, clientState);
        break;
      case "set_pin_value":
        await this.params.handlers.setPinValue(ws, data, clientState);
        break;
    }
  }
}
