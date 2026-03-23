import { useWebSocketHandler } from "@/hooks/useWebSocketHandler";
import type { UseWebSocketHandlerParams } from "@/hooks/useWebSocketHandler";

/**
 * A thin abstraction over useWebSocketHandler that keeps the page hook more focused
 * on orchestration and reduces visual noise from the large handler parameter list.
 */
export function useSimulatorWebSocketBridge(params: UseWebSocketHandlerParams) {
  useWebSocketHandler(params);
}
