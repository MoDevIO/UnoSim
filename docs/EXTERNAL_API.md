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

The simulator sends response messages back to the parent frame using `window.postMessage`.

### Response Schema

```ts
interface SimulatorResponse {
  type: string;       // The action type the response corresponds to
  success: boolean;   // Whether the action was handled successfully
  data?: unknown;     // Optional data (e.g. pin value)
  error?: string;     // Error description when success is false
}
```

### Example: `GET_PIN_STATE` response

```js
// Parent page listener:
window.addEventListener("message", (event) => {
  if (event.origin !== "https://simulator.example.com") return;
  const { type, success, data } = event.data;
  if (type === "GET_PIN_STATE" && success) {
    console.log("Pin value:", data); // e.g. 1
  }
});
```

---

## Complete Embedding Example

```html
<!DOCTYPE html>
<html>
<body>
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

    // 1. Load a sketch
    sim.postMessage(
      { type: "LOAD_CODE", payload: { code: "void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);delay(500);digitalWrite(13,LOW);delay(500);}" } },
      SIMULATOR_ORIGIN
    );

    // 2. Start it after a short delay
    setTimeout(() => {
      sim.postMessage({ type: "START_SIMULATION", payload: undefined }, SIMULATOR_ORIGIN);
    }, 1000);

    // 3. Listen for responses
    window.addEventListener("message", (e) => {
      if (e.origin !== SIMULATOR_ORIGIN) return;
      console.log("Simulator says:", e.data);
    });
  </script>
</body>
</html>
```

---

## Type Definitions

The full TypeScript types are available in [`client/src/types/external-api.ts`](../client/src/types/external-api.ts).
