import type { WSMessage } from "@shared/schema";
import { isAnalogPin } from "@/lib/active-board";
import type { RuntimeHub } from "./runtime-hub";

/**
 * The boundary between the controllers and the active runtime (plan P3.4).
 * The controllers keep sending the messages they send today; while the
 * active run is a browser run, this router turns the run commands into
 * runtime calls instead of WebSocket messages. Runs of the host mock, and
 * everything else (compile, `start_simulation`), go the old way.
 */
export interface RuntimeCommandRouter {
  /** True if the browser runtime took the message; false means: send it over the connection as before. */
  route(message: WSMessage): boolean;
  /** An analog value from a slider; true if the browser runtime took it. */
  setAnalog(pin: number, value: number): boolean;
}

export function createRuntimeCommandRouter(hub: Pick<RuntimeHub, "active" | "peek">): RuntimeCommandRouter {
  const browser = () => (hub.active === "browser" ? hub.peek("browser") : undefined);
  return {
    route(message) {
      const runtime = browser();
      if (!runtime) return false;
      switch (message.type) {
        case "pause_simulation":
          runtime.pause();
          return true;
        case "resume_simulation":
          runtime.resume();
          return true;
        case "stop_simulation":
        case "code_changed":
          runtime.stop();
          return true;
        case "serial_input":
          if (message.port === undefined) runtime.sendSerial(message.data);
          else runtime.sendSerial(message.data, message.port);
          return true;
        case "set_pin_value":
          // An external value above 1 on an analog input of the selected board (A0–A5 Uno, A0–A7 Nano, A0–A15 Mega) is an analog value.
          if (isAnalogPin(message.pin) && message.value > 1) runtime.setAnalog(message.pin, message.value);
          else runtime.setPin(message.pin, message.value);
          return true;
        default:
          return false;
      }
    },
    setAnalog(pin, value) {
      const runtime = browser();
      runtime?.setAnalog(pin, value);
      return runtime !== undefined;
    },
  };
}
