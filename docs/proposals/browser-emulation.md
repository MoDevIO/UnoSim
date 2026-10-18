# Vorschlag: Sketches emulieren statt auf dem Host ausführen

> **Nicht normativ.** Übergabe-Notiz für die Diskussion eines größeren Umbaus
> (Stand 2026-10-18, UnoSim `v1.0.1`). Sie fasst Anlass, ein Prototyp-Ergebnis
> und offene Entscheidungen zusammen. Entscheidungen gehören danach in einen ADR
> unter [../adr/](../adr/).

## 1. Anlass

UnoSim prüft einen Sketch mit `arduino-cli` für den Uno und führt ihn danach
**nicht als Uno-Programm** aus, sondern übersetzt ihn mit g++ für den Server
und linkt ihn gegen einen Arduino-Mock. Daraus folgen Abweichungen, die sich im
Unterricht bemerkbar machen (vollständige Liste:
[Grenzen der Simulation](../USER_GUIDE.md#grenzen-der-simulation)):

- `int`/`unsigned int` haben 32 statt 16 Bit: `32767 + 1` ergibt 32768. Die
  Folie IT02 „Grenzen des Datentyps int“ ist damit nicht nachvollziehbar.
- `long` und `double` haben 64 statt 32 Bit, `sizeof` zeigt Server-Werte.
- `Serial.print(2.5)` gibt `2.5` statt `2.50` aus.
- `Serial.parseInt()` wartet nicht auf sein Timeout.
- `loop()` läuft etwa 350-mal seltener als auf dem Uno (IT05.5: rund 390 statt
  rund 137 000 Durchläufe pro 500 ms), 2 KB RAM werden nicht erzwungen,
  `random()` liefert eine andere Folge.

Auf dem Host lässt sich das nicht sauber beheben: g++ hat für x86/ARM keinen
Schalter für 16-Bit-`int`, und Ersatztypen (`#define int int16_t`, eine Klasse
`Int16`) scheitern an Integer-Promotion, Literalen, `switch` und `sizeof`.

Der Mock musste außerdem mehrfach an die Arduino IDE angeglichen werden (v1.0.1:
Prototyp-Platzierung, `INPUT_PULLUP`). Jede solche Lücke ist ein eigener Fehler.

## 2. Prototyp: das echte Uno-HEX in avr8js

`arduino-cli` erzeugt das HEX für den ATmega328P bereits; UnoSim legt es im
Compile-Cache ab ([arduino-compiler.ts](../../server/services/arduino-compiler.ts),
[cli-runner.ts](../../server/services/compiler/cli-runner.ts)). Ein Node-Skript
(Anhang A, rund 90 Zeilen) führt dieses HEX in **avr8js** aus: CPU mit 16 MHz,
Timer0–2, USART, Ports B/C/D, ADC.

**Ergebnis (gemessen 2026-10-16 auf Apple M2 Pro, avr8js 0.21.0):**

| Prüfung | UnoSim heute | avr8js | Uno |
|---|---|---|---|
| `int` 32767 + 1 | 32768 | −32768 | −32768 |
| `unsigned int` 65535 + 1 | 65536 | 0 | 0 |
| `int` 300 * 200 | 60000 | −5536 | −5536 |
| `sizeof` int/long/float/double | 4/8/4/8 | 2/4/4/4 | 2/4/4/4 |
| `Serial.print(2.5)` | 2.5 | 2.50 | 2.50 |
| `delay(587)` gemessen mit `millis()` | 589–592 ms | 586 ms | ca. 586–587 ms |
| `analogRead` bei 2,77 V / 3,42 V | – | 567 / 700 | 567 / 700 |
| `analogWrite(11, 25)` | PWM-Ereignis | OCR2A = 25 | OCR2A = 25 |
| `parseInt` ohne Eingabe | sofort 0 | wartet 1 s | wartet 1 s |

Die Kursbeispiele IT02.4, IT03.6, IT03.7, IT04.2, IT04.3, IT05.4, IT05.5 und
IT11.5 (UnoSim-Examples `v3.0.0`) liefen mit der erwarteten Ausgabe.

**Rechenbedarf:** etwa **4,5-fache Echtzeit pro Kern** (4 Läufe parallel:
4,5x je Lauf; rechenlastiger Sketch IT11.5: 6,6x). Eine Simulation in
Echtzeit belegt also rund **ein Viertel Kern**, auch während `delay()`, weil
jeder Takt emuliert wird.

**Folgerung:** Das [Kapazitätsmodell](../CAPACITY_MODEL.md) sieht 70
gleichzeitige Simulationen auf einem Core i9-10900T (10 Kerne) vor. Das wären
grob 20–25 solcher Kerne. **Serverseitig reicht das nicht; im Browser der
Studierenden schon.**

## 3. Zielbild (Diskussionsstand)

- **Server kompiliert, Browser führt aus.** Der Server liefert nur das HEX aus
  dem bestehenden Compile-Schritt; der Emulator läuft im Browser.
- Damit läuft auf dem Server **kein nativer Studierenden-Code** mehr. Die
  Docker-Sandbox für die Laufzeit
  ([sandbox-runner.ts](../../server/services/sandbox-runner.ts),
  [SECURITY.md](../SECURITY.md)) würde weitgehend entfallen; der Compile-Schritt
  braucht seine Absicherung weiterhin.
- **Mehrere Boards** werden strukturell möglich: `arduino-cli` mit dem
  passenden Core, im Browser der passende Emulator.

Zwei Varianten des Schnitts:

1. **Laufzeit in UnoSim austauschen** (Empfehlung aus der Diskussion): ein
   eigenes Paket/Repo für den Emulationskern (Board-Definition, Emulator,
   Peripherie, Ereignisprotokoll) und in UnoSim eine Runner-Abstraktion mit den
   Backends „Browser-Emulation“ (neu) und „Host-Mock“ (bisher, Rückfallebene).
   Tutor, Course Content, Beispiel-Provider, Gateway, Kapazitätsmodell, Tests
   und Betriebsdoku bleiben erhalten.
2. **Neues Projekt** („Wokwi-ähnlich mit der UnoSim-Oberfläche“, UnoSim als
   Quelle). Freier im Zuschnitt, muss aber die genannten UnoSim-Teile neu
   aufbauen oder übernehmen.

## 4. Bibliotheken und Boards (vor einer Zusage nachprüfen)

| Bibliothek | Zweck | Lizenz |
|---|---|---|
| avr8js | Uno, Nano, Mega, ATtiny | MIT |
| rp2040js | Raspberry Pi Pico | MIT |
| @wokwi/elements | Board- und Bauteilgrafiken | MIT |

Für den ESP32 gibt es nach bisherigem Kenntnisstand **keine offene
Wokwi-Bibliothek**; Alternativen wie QEMU (Espressif-Fork) oder Renode (STM32)
sind deutlich schwerer und laufen eher serverseitig. Den Namen „Wokwi“ nicht
verwenden (Marke).

Vorgeschlagene Reihenfolge: Uno exakt im Browser mit allem, was UnoSim heute
kann → Nano/Mega → Pico → ESP32 nur bei Bedarf.

## 5. Offene Entscheidungen

1. **Verdrahtung und externe Bauteile** (Steckbrett, LEDs, Taster, LDR,
   Ultraschall) in der Simulation: ja oder nein? Das ist voraussichtlich der
   größte Brocken – größer als die Emulation.
2. **Welche Boards** werden konkret gebraucht?
3. **Variante 1 oder 2** aus Abschnitt 3?
4. Was passiert mit der **IO-Registry** (heute teils aus dem Mock, z. B. welche
   Funktion einen Pin benutzt) und den **Tutor-Fakten**, die aus dem Sketch
   abgeleitet werden?
5. **Pause/Resume, Timeout und Laufzeitlimits** im Browser: Wer setzt sie durch?
6. **Messbarer erster Meilenstein**, Vorschlag: alle 51 Beispiele aus
   UnoSim-Examples `v3.0.0` laufen im Browser-Emulator mit der Ausgabe eines
   echten Uno.

## 6. Einstiegspunkte im Code

- Sketch-Aufbereitung für g++ und Prototypen:
  [sketch-file-builder.ts](../../server/services/sketch-file-builder.ts),
  [sketch-prototypes.ts](../../server/services/sketch-prototypes.ts)
- Arduino-Mock: [server/mocks/arduino-mock/](../../server/mocks/arduino-mock/);
  Protokoll stdin/stderr (`SERIAL_EVENT`, `PIN_VALUE`, `PIN_PWM`, `PIN_MODE`,
  `SET_PIN`, Pause/Resume) in
  [arduino-stdin.ts](../../server/mocks/arduino-mock/arduino-stdin.ts) und
  [arduino-registry-logic.ts](../../server/mocks/arduino-mock/arduino-registry-logic.ts)
- Laufzeit-Sandbox: [sandbox-runner.ts](../../server/services/sandbox-runner.ts)
- Compile und HEX-Cache: [arduino-compiler.ts](../../server/services/arduino-compiler.ts),
  [cli-runner.ts](../../server/services/compiler/cli-runner.ts)
- Statische IO-Analyse: [io-registry-parser.ts](../../shared/io-registry-parser.ts);
  Tutor-Fakten: [sketch-facts.ts](../../server/services/tutor/curriculum/sketch-facts.ts)
- Board und Pinzustand im Client:
  [arduino-board.tsx](../../client/src/components/features/arduino-board.tsx),
  [use-simulation-store.ts](../../client/src/hooks/use-simulation-store.ts)
- Betrieb: [CAPACITY_MODEL.md](../CAPACITY_MODEL.md), [SECURITY.md](../SECURITY.md)

## Anhang A: Prototyp-Skript

Lauffähig mit Node 24 und `npm install avr8js@0.21.0` in einem eigenen
Verzeichnis (nicht Teil von UnoSim). Das HEX entsteht mit
`arduino-cli compile -b arduino:avr:uno --output-dir out <sketchdir>`; verwendet
wird `out/<sketch>.ino.hex`. Hinweis: avr8js bildet den internen Pull-up nicht
selbst nach; das Skript ergänzt ihn.

```js
// Usage: node run-hex.mjs <sketch.hex> <simSeconds> [events-json]
//   events: [[simMs, "serial", "text"], [simMs, "pin", 2, 0], [simMs, "adc", 0, 2.77]]
import { readFileSync } from "node:fs";
import {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRUSART, usart0Config, AVRIOPort, portBConfig, portCConfig, portDConfig, AVRADC, adcConfig,
} from "avr8js";

const FREQ = 16_000_000;
const [hexPath, simSecondsArg, eventsArg] = process.argv.slice(2);
const simSeconds = Number(simSecondsArg ?? 2);
const events = (eventsArg ? JSON.parse(eventsArg) : []).sort((a, b) => a[0] - b[0]);

// Intel HEX -> program memory
const flash = new Uint8Array(0x8000);
for (const line of readFileSync(hexPath, "utf8").split(/\r?\n/)) {
  if (!line.startsWith(":")) continue;
  const bytes = Buffer.from(line.slice(1), "hex");
  const [count, addrHi, addrLo, type] = bytes;
  if (type === 0) flash.set(bytes.subarray(4, 4 + count), (addrHi << 8) | addrLo);
}
const cpu = new CPU(new Uint16Array(flash.buffer));

// Peripherals of the ATmega328P
new AVRTimer(cpu, timer0Config);                 // millis(), delay(), PWM 5/6
new AVRTimer(cpu, timer1Config);                 // PWM 9/10
new AVRTimer(cpu, timer2Config);                 // PWM 3/11
const usart = new AVRUSART(cpu, usart0Config, FREQ);
const portB = new AVRIOPort(cpu, portBConfig);   // D8..D13
const portC = new AVRIOPort(cpu, portCConfig);   // A0..A5
const portD = new AVRIOPort(cpu, portDConfig);   // D0..D7
const adc = new AVRADC(cpu, adcConfig);          // channelValues[] in volts
const digital = (pin) => (pin < 8 ? [portD, pin] : pin < 14 ? [portB, pin - 8] : [portC, pin - 14]);

// Serial out and in
let serial = "";
usart.onByteTransmit = (byte) => { serial += String.fromCharCode(byte); };
const rxQueue = [];
const pumpRx = () => { if (rxQueue.length && !usart.rxBusy) usart.writeByte(rxQueue.shift()); };

// Internal pull-up: an input with its PORT bit set reads HIGH unless driven externally
const external = new Set();
for (const [port, config, firstPin] of [[portD, portDConfig, 0], [portB, portBConfig, 8], [portC, portCConfig, 14]]) {
  port.addListener(() => {
    const ddr = cpu.data[config.DDR];
    const out = cpu.data[config.PORT];
    for (let bit = 0; bit < 8; bit++) {
      if (external.has(firstPin + bit) || ddr & (1 << bit)) continue;
      port.setPin(bit, Boolean(out & (1 << bit)));
    }
  });
}

function applyEvent([, kind, a, b]) {
  if (kind === "serial") for (const ch of `${a}\n`) rxQueue.push(ch.charCodeAt(0));
  if (kind === "pin") { external.add(a); const [port, bit] = digital(a); port.setPin(bit, Boolean(b)); }
  if (kind === "adc") adc.channelValues[a] = b;
}

const endCycles = simSeconds * FREQ;
let nextEvent = 0;
const start = process.hrtime.bigint();
while (cpu.cycles < endCycles) {
  while (nextEvent < events.length && cpu.cycles >= events[nextEvent][0] * (FREQ / 1000)) applyEvent(events[nextEvent++]);
  for (let i = 0; i < 1000; i++) { avrInstruction(cpu); cpu.tick(); }
  pumpRx();
}
const wallMs = Number(process.hrtime.bigint() - start) / 1e6;

console.log(serial.replaceAll("\r", ""));
console.log("PWM compare registers", JSON.stringify({ D9: cpu.data[0x88], D11: cpu.data[0xb3], D6: cpu.data[0x47], D5: cpu.data[0x48] }));
console.log(`simulated ${simSeconds * 1000} ms in ${wallMs.toFixed(0)} ms -> ${(simSeconds * 1000 / wallMs).toFixed(2)}x real time`);
```

Beispielaufruf für den `int`-Test aus Abschnitt 2:

```sh
node run-hex.mjs out/int-probe.ino.hex 0.2
```

## Anhang B: Testsketch `int-probe.ino`

```cpp
void setup() {
  Serial.begin(115200);
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  unsigned int u = 65535;
  u++;
  Serial.print("unsigned int 65535 + 1 = ");
  Serial.println(u);
  int produkt = 300 * 200;
  Serial.print("int 300 * 200 = ");
  Serial.println(produkt);
  Serial.print("sizeof int/long/float/double = ");
  Serial.print(sizeof(int)); Serial.print("/"); Serial.print(sizeof(long)); Serial.print("/");
  Serial.print(sizeof(float)); Serial.print("/"); Serial.println(sizeof(double));
  Serial.print("print(2.5) = ");
  Serial.println(2.5);
  Serial.println("DONE");
}
void loop() {}
```
