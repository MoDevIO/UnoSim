# External API (postMessage Protocol)

Status: current

The Arduino Simulator can be embedded in an `<iframe>` and controlled by its parent page via the [Window.postMessage API](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage).

**API Version: 1.4.0**

---

## Security

The simulator only processes messages whose `event.origin` exactly matches the detected parent origin (`window.location.ancestorOrigins[0]`).  
When the simulator runs top-level (not in an iframe) the effective allowed origin is `"*"` (any).  
Messages from all other origins are silently discarded.

> Important: iframe embedding is controlled by the simulator page's own CSP header, not by the parent page.

For local development, the simulator allows embedding from common local test hosts by default:
- `'self'`
- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:5173`
- `http://127.0.0.1:5173`

If your test application runs on `http://localhost:5173`, the simulator origin must explicitly allow that host in its `frame-ancestors` CSP directive.

If you need to allow additional parent origins, set the environment variable `SIMULATOR_ALLOWED_PARENT_ORIGINS` with a comma-separated list of origins before starting the simulator. For example:

```bash
SIMULATOR_ALLOWED_PARENT_ORIGINS=http://localhost:3000
```

This is required when your test website is hosted on a different origin than the simulator.

---

## Inbound Messages (Website → Simulator)

All messages must be sent as plain JSON-serialisable objects with a `type` field that matches one of the `SimulatorActionType` enum values. Every inbound action triggers a **response message** back to the parent (see Outbound Messages).

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

### `PAUSE_SIMULATION`

Pauses a running simulation (preserves state). *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "PAUSE_SIMULATION", payload: undefined },
  "https://your-site.example.com"
);
```

---

### `RESUME_SIMULATION`

Resumes a paused simulation. *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "RESUME_SIMULATION", payload: undefined },
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

Requests the current value of a pin. The simulator replies with a response containing the pin value in `data`.

```js
iframe.contentWindow.postMessage(
  { type: "GET_PIN_STATE", payload: { pin: 3 } },
  "https://your-site.example.com"
);
```

---

### `BATCH_SET_PIN_STATE`

Sets multiple pins in a single operation. *Added in v1.1.0.*

```js
iframe.contentWindow.postMessage(
  {
    type: "BATCH_SET_PIN_STATE",
    payload: {
      pins: [
        { pin: 7, value: 1 },
        { pin: 8, value: 0 },
        { pin: 13, value: 1 },
      ]
    }
  },
  "https://your-site.example.com"
);
```

| Field | Type | Description |
|-------|------|-------------|
| `payload.pins` | `Array<{pin: number, value: number}>` | Array of pin/value pairs to set. |

---

### `SERIAL_INPUT`

Sends serial data to the running simulation (equivalent to typing in the serial monitor). *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "SERIAL_INPUT", payload: { data: "Hello\n" } },
  "https://your-site.example.com"
);
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.data` | `string` | ✅ | Serial data to send to the sketch. |

---

### `SET_SIMULATION_TIMEOUT`

Changes the simulation timeout (in milliseconds). *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "SET_SIMULATION_TIMEOUT", payload: { timeout: 30000 } },
  "https://your-site.example.com"
);
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.timeout` | `number` | ✅ | Timeout in milliseconds (must be ≥ 0). |

---

### `SET_OUTPUT_TAB`

Switches the active output tab in the simulator UI. *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "SET_OUTPUT_TAB", payload: { tab: "compiler" } },
  "https://your-site.example.com"
);
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `payload.tab` | `string` | ✅ | One of: `"compiler"`, `"messages"`, `"registry"`, `"debug"`. |

---

### `GET_SIMULATION_STATE`

Requests the current simulation state. The simulator replies with the state in `data`. *Added in v1.2.0.*

```js
iframe.contentWindow.postMessage(
  { type: "GET_SIMULATION_STATE", payload: undefined },
  "https://your-site.example.com"
);
```

**Response `data`**: `"IDLE"` | `"QUEUED_FOR_COMPILING"` | `"COMPILING"` | `"QUEUED_FOR_SIMULATION"` | `"RUNNING"` | `"PAUSED"` | `"ERROR"`

> **Migration note (v1.4.0):** Previously returned lowercase values (`"stopped"`, `"running"`, `"paused"`, `"compiling"`). Now returns uppercase `ClientState` values matching the `SIMULATION_STATE_EVENT`.

---

## Outbound Messages (Simulator → Website)

The simulator sends two types of messages back to the parent frame via `window.parent.postMessage`:

1. **Responses** – sent in reply to every inbound action (RPC-style)
2. **Events** – sent proactively to notify of state changes (without explicit request)

---

### Response Messages

Every inbound action receives a response. This enables the caller to confirm the action was processed.

#### Response Schema

```ts
interface SimulatorResponse {
  version: string;    // API version (e.g. "1.4.0")
  type: string;       // The action type the response corresponds to
  success: boolean;   // Whether the action was handled successfully
  data?: unknown;     // Optional data (e.g. pin value for GET_PIN_STATE)
  error?: string;     // Error description when success is false
}
```

#### Example: Successful response

```js
// Response to LOAD_CODE:
{ version: "1.4.0", type: "LOAD_CODE", success: true }

// Response to GET_PIN_STATE:
{ version: "1.4.0", type: "GET_PIN_STATE", success: true, data: 1 }

// Response to GET_SIMULATION_STATE:
{ version: "1.4.0", type: "GET_SIMULATION_STATE", success: true, data: "running" }
```

#### Example: Error response (payload validation failed)

```js
{ version: "1.4.0", type: "SET_PIN_STATE", success: false, error: "payload.pin and payload.value must be numbers" }
```

---

### Proactive Event Messages

Event messages are sent **without request** to inform the parent of state changes in real-time.

#### Event Message Schema

```ts
interface SimulatorEventMessage {
  version: string;    // API version (e.g. "1.4.0")
  type: string;       // Event type
  success: true;      // Events always report success:true
  data?: unknown;     // Event-specific payload
}
```

#### `SERIAL_OUTPUT_EVENT`

Fired every time the simulator outputs data over the serial interface (Serial.print, Serial.println, etc.).

```js
{
  type: "SERIAL_OUTPUT_EVENT",
  version: "1.4.0",
  success: true,
  data: "Hello World\n"
}
```

#### `PIN_STATE_CHANGE_EVENT`

Fired when a digital or analog pin changes value during simulation.

```js
{
  type: "PIN_STATE_CHANGE_EVENT",
  version: "1.4.0",
  success: true,
  data: { pin: 13, value: 1 }
}
```

#### `SIMULATION_STATE_EVENT`

Fired when the simulation changes state.

```js
{
  type: "SIMULATION_STATE_EVENT",
  version: "1.4.0",
  success: true,
  data: { state: "RUNNING", message: "Simulation started" }
}
```

`data.state`: `"IDLE"` | `"QUEUED_FOR_COMPILING"` | `"COMPILING"` | `"QUEUED_FOR_SIMULATION"` | `"RUNNING"` | `"PAUSED"` | `"ERROR"`

> **Migration note (v1.4.0):** The `"STOPPED"` and `"QUEUED"` values are replaced by `"IDLE"` and `"QUEUED_FOR_COMPILING"` respectively. `"COMPILING"` and `"QUEUED_FOR_SIMULATION"` have been added. `"QUEUED_FOR_RUNNING"` has been removed.

---

## Complete Embedding Example

```html
<!DOCTYPE html>
<html>
<body>
  <h1>Arduino Simulator Dashboard</h1>
  <div id="status">Idle</div>
  <div id="serial-output"></div>
  
  <iframe id="sim" src="https://simulator.example.com"
    width="1200" height="800" allow="clipboard-write"></iframe>

  <script>
    const SIMULATOR_ORIGIN = "https://simulator.example.com";
    const sim = document.getElementById("sim").contentWindow;

    function loadAndRun() {
      const sketch = `
        void setup() { Serial.begin(9600); pinMode(13, OUTPUT); }
        void loop() {
          digitalWrite(13, HIGH); Serial.println("LED ON"); delay(500);
          digitalWrite(13, LOW);  Serial.println("LED OFF"); delay(500);
        }
      `;
      sim.postMessage({ type: "LOAD_CODE", payload: { code: sketch } }, SIMULATOR_ORIGIN);
      setTimeout(() => {
        sim.postMessage({ type: "SET_SIMULATION_TIMEOUT", payload: { timeout: 30000 } }, SIMULATOR_ORIGIN);
        sim.postMessage({ type: "START_SIMULATION", payload: undefined }, SIMULATOR_ORIGIN);
      }, 500);
    }

    window.addEventListener("message", (event) => {
      if (event.origin !== SIMULATOR_ORIGIN) return;
      const { type, success, data, error, version } = event.data;
      console.log(`[API v${version}]`, type, success ? data : error);

      if (type === "SERIAL_OUTPUT_EVENT")
        document.getElementById("serial-output").textContent += data;
      if (type === "SIMULATION_STATE_EVENT")
        document.getElementById("status").textContent = `Status: ${data.state}`;
    });

    loadAndRun();
  </script>
</body>
</html>
```

---

## Type Definitions

The full TypeScript types are available in [`client/src/types/external-api.ts`](../client/src/types/external-api.ts).
