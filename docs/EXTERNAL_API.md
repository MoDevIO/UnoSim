# External API (postMessage Protocol)

The Arduino Simulator can be embedded in an `<iframe>` and controlled by its parent page via the [Window.postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

---

## Security

The simulator only processes messages whose `event.origin` exactly matches the detected parent origin (`window.location.ancestorOrigins[0]`).  
When the simulator runs top-level (not in an iframe) the effective allowed origin is `"*"` (any).  
Messages from all other origins are silently discarded.

---

## Inbound Messages (Website → Simulator)

All messages must be sent as plain JSON-serialisable objects with a `type` field that matches one of the `SimulatorActionType` enum values.

### `LOAD_CODE`

Replaces the code in the editor.

```js
iframe.contentWindow.postMessage(
  { type: "LOAD_CODE", payload: { code: "void setup() {}\nvoid loop() {}" } },
  "https://your-site.example.com"
);
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.code` | `string` | ✅ | The sketch source code to load. |

---

### `START_SIMULATION`

Compiles the current sketch and starts the simulation (equivalent to pressing **▶ Run**).

```js
iframe.contentWindow.postMessage(
  { type: "START_SIMULATION", payload: undefined },
  "https://your-site.example.com"
);
```

---

### `STOP_SIMULATION`

Stops a running or paused simulation.

```js
iframe.contentWindow.postMessage(
  { type: "STOP_SIMULATION", payload: undefined },
  "https://your-site.example.com"
);
```

---

### `SET_PIN_STATE`

Sets the value of a digital or analog pin.

```js
iframe.contentWindow.postMessage(
  { type: "SET_PIN_STATE", payload: { pin: 7, value: 1 } },
  "https://your-site.example.com"
);
```

| Field | Type | Description |
|-------|------|-------------|
| `payload.pin` | `number` | Pin number (digital: 0–13, analog: 14–19 for A0–A5). |
| `payload.value` | `number` | Digital: `0` or `1`. Analog: `0–1023`. PWM: `0–255`. |

---

### `GET_PIN_STATE`

Requests the current value of a pin. The simulator replies via `postMessage` (see **Outbound Messages** below).

```js
iframe.contentWindow.postMessage(
  { type: "GET_PIN_STATE", payload: { pin: 3 } },
  "https://your-site.example.com"
);
```

---

## Outbound Messages (Simulator → Website)

The simulator sends two types of messages back to the parent frame via `window.postMessage`:

1. **Responses** – sent in reply to explicit requests (RPC-style)
2. **Events** – sent proactively to notify of state changes (without explicit request)

---

### Response Messages

Response messages reply to explicit inbound requests.

#### Response Schema

```ts
interface SimulatorResponse {
  version: string;    // API version (e.g. "1.1.0")
  type: string;       // The action type the response corresponds to
  success: boolean;   // Whether the action was handled successfully
  data?: unknown;     // Optional data (e.g. pin value for GET_PIN_STATE)
  error?: string;     // Error description when success is false
}
```

#### Example: `GET_PIN_STATE` response

```js
// Parent page listener:
window.addEventListener("message", (event) => {
  if (event.origin !== "https://simulator.example.com") return;
  const { type, success, data, version } = event.data;
  if (type === "GET_PIN_STATE" && success) {
    console.log(`Pin value: ${data} (API v${version})`); // e.g. 1 (API v1.1.0)
  }
});
```

---

### Proactive Event Messages

Event messages are sent **without request** to inform the parent of state changes in real-time. These enable the dashboard to track simulation progress.

#### Event Message Schema

```ts
interface SimulatorEventMessage {
  version: string;    // API version (e.g. "1.1.0")
  type: string;       // Event type (SERIAL_OUTPUT_EVENT, PIN_STATE_CHANGE_EVENT, SIMULATION_STATE_EVENT)
  success: true;      // Events always report success:true
  data?: unknown;     // Event-specific payload
}
```

#### `SERIAL_OUTPUT_EVENT`

Fired every time the simulator outputs data over the serial interface (Serial.print, Serial.println, etc.).

```js
{
  type: "SERIAL_OUTPUT_EVENT",
  version: "1.1.0",
  success: true,
  data: "Hello World\n"  // String chunk (may contain line breaks)
}
```

**Use cases**: Display live serial monitor, stream debug logs, update dashboard.

#### `PIN_STATE_CHANGE_EVENT`

Fired when a digital or analog pin changes value during simulation.

```js
{
  type: "PIN_STATE_CHANGE_EVENT",
  version: "1.1.0",
  success: true,
  data: {
    pin: 13,    // Pin number (0-13 for digital, 14-19 for analog A0-A5)
    value: 1    // New value (0-1 for digital, 0-1023 for analog, 0-255 for PWM)
  }
}
```

**Use cases**: Real-time pin state visualization, circuit status monitoring, interactive dashboards.

#### `SIMULATION_STATE_EVENT`

Fired when the simulation changes state (started, stopped, paused, or encountered an error).

```js
{
  type: "SIMULATION_STATE_EVENT",
  version: "1.1.0",
  success: true,
  data: {
    state: "RUNNING",        // "RUNNING" | "STOPPED" | "PAUSED" | "ERROR"
    message: "Simulation started at 10:45 AM"  // Optional status message
  }
}
```

**Use cases**: Update simulation status display, enable/disable controls conditionally, log simulation events.

#### Example: Listen to all events

```js
const SIMULATOR_ORIGIN = "https://simulator.example.com";

window.addEventListener("message", (event) => {
  // Validate origin (OWASP S2819)
  if (event.origin !== SIMULATOR_ORIGIN) return;
  
  const { type, version, success, data } = event.data;
  
  switch (type) {
    case "SERIAL_OUTPUT_EVENT":
      console.log(`[v${version}] Serial output:`, data);
      // Update dashboard serial monitor
      break;
      
    case "PIN_STATE_CHANGE_EVENT":
      console.log(`[v${version}] Pin ${data.pin} changed to ${data.value}`);
      // Update circuit visualization
      break;
      
    case "SIMULATION_STATE_EVENT":
      console.log(`[v${version}] Simulation state: ${data.state}`);
      // Update status indicator
      break;
  }
});
```

---

## Complete Embedding Example

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Arduino Simulator Dashboard</h1>
  <div id="status">Idle</div>
  <div id="serial-output"></div>
  <div id="pin-states"></div>
  
  <iframe
    id="sim"
    src="https://simulator.example.com"
    width="1200"
    height="800"
    allow="clipboard-write"
  ></iframe>

  <script>
    const SIMULATOR_ORIGIN = "https://simulator.example.com";
    const sim = document.getElementById("sim").contentWindow;

    // Send a sketch to the simulator
    function loadAndStartSketch() {
      const sketch = `
        void setup() {
          Serial.begin(9600);
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          Serial.println("LED ON");
          delay(500);
          digitalWrite(13, LOW);
          Serial.println("LED OFF");
          delay(500);
        }
      `;

      // 1. Load sketch
      sim.postMessage(
        { type: "LOAD_CODE", payload: { code: sketch } },
        SIMULATOR_ORIGIN
      );

      // 2. Start simulation after brief delay
      setTimeout(() => {
        sim.postMessage(
          { type: "START_SIMULATION", payload: undefined },
          SIMULATOR_ORIGIN
        );
      }, 500);
    }

    // 3. Listen for all messages from simulator
    window.addEventListener("message", (event) => {
      // Validate origin (OWASP S2819)
      if (event.origin !== SIMULATOR_ORIGIN) return;

      const { type, success, data, version } = event.data;
      console.log(`[API v${version}] Received:`, { type, success, data });

      // Handle responses (RPC replies)
      if (type === "GET_PIN_STATE" && success) {
        document.getElementById("pin-states").textContent = `Pin 13: ${data}`;
      }

      // Handle proactive events
      if (type === "SERIAL_OUTPUT_EVENT") {
        const output = document.getElementById("serial-output");
        output.textContent += data; // Append serial data
      }

      if (type === "PIN_STATE_CHANGE_EVENT") {
        console.log(`Pin ${data.pin} → ${data.value}`);
        // Update circuit visualization here
      }

      if (type === "SIMULATION_STATE_EVENT") {
        document.getElementById("status").textContent = `Status: ${data.state}`;
      }
    });

    // 4. Periodically check pin 13 state
    setInterval(() => {
      sim.postMessage(
        { type: "GET_PIN_STATE", payload: { pin: 13 } },
        SIMULATOR_ORIGIN
      );
    }, 2000);

    // Start the simulation
    loadAndStartSketch();
  </script>
</body>
</html>
```

---

## Type Definitions

The full TypeScript types are available in [`client/src/types/external-api.ts`](../client/src/types/external-api.ts).
