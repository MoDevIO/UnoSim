import type { UmlCodeContext } from "../../../../../shared/tutor-uml";
export const ref = (
  startLine: number,
  endLine = startLine,
  file = "main.ino",
) => ({ file, startLine, endLine });
export const context = (
  code: string,
  question = "Wie verzweigt der Ablauf und wo treffen die beiden Pfade wieder zusammen?",
): UmlCodeContext => ({
  code,
  question,
  entryFile: "main.ino",
  board: "uno",
  headers: {},
});
export const activityCode = `void run() {
  if (ready) {
    on();
  } else {
    off();
  }
  after();
}`;
export const activity = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "activity",
  purpose:
    "Die Verzweigung von run und die Zusammenführung vor after sichtbar machen.",
  scope: ref(1, 8),
  body: [
    {
      type: "decision",
      condition: "ready",
      ref: ref(2, 6),
      whenTrue: [{ type: "action", code: "on();", ref: ref(3) }],
      whenFalse: [{ type: "action", code: "off();", ref: ref(5) }],
    },
    { type: "action", code: "after();", ref: ref(7) },
  ],
};
export const classCode = `class Base {
public:
  int value;
  void go(int x);
};
class Child : public Base {
private:
  Base *peer;
};`;
export const classes = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "class",
  purpose:
    "Die Vererbung von Child zu Base und ihre deklarierten Member vergleichen.",
  scope: ref(1, 9),
  classes: [
    {
      name: "Base",
      ref: ref(1, 5),
      members: [
        {
          kind: "attribute",
          declaration: "int value",
          visibility: "public",
          ref: ref(3),
        },
        {
          kind: "operation",
          declaration: "void go(int x)",
          visibility: "public",
          ref: ref(4),
        },
      ],
    },
    {
      name: "Child",
      ref: ref(6, 9),
      members: [
        {
          kind: "attribute",
          declaration: "Base *peer",
          visibility: "private",
          ref: ref(8),
        },
      ],
    },
  ],
  relations: [
    { kind: "generalization", from: "Child", to: "Base", ref: ref(6) },
  ],
};
export const sequenceCode = `class Sensor { public: int read() { return 1; } };
Sensor sensor;
void run() {
  sensor.read();
  sensor.read();
}`;
export const sequence = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "sequence",
  purpose:
    "Die zwei synchronen Aufrufe von run an sensor in ihrer Reihenfolge verfolgen.",
  scope: ref(3, 6),
  participants: [
    { kind: "context", name: "run", ref: ref(3, 6) },
    { kind: "object", name: "sensor", className: "Sensor", ref: ref(2) },
  ],
  messages: [
    {
      type: "call",
      from: "run",
      to: "sensor",
      code: "sensor.read()",
      ref: ref(4),
    },
    {
      type: "return",
      from: "sensor",
      to: "run",
      code: "return 1;",
      ref: ref(1),
    },
    {
      type: "call",
      from: "run",
      to: "sensor",
      code: "sensor.read()",
      ref: ref(5),
    },
  ],
};
// Hand-checked verbatim teaching question and executable excerpt from IT08.6; no product fixture changed.
export const it086Question =
  "Warum besteht der Test mit `mittelwert(4, 8)`, obwohl `mittelwert` einen Fehler enthält?";
export const it086Code = `float mittelwert(int wert1, int wert2) {
  return (wert1 + wert2) / 2;
}
void setup() {
  pruefeGleich("mittelwert(4, 8)", mittelwert(4, 8), 6.0);
}`;
// Pinned Arduino AVR callback excerpt; runtime ordering is supplied only by the app catalog.
export const arduinoCode = `void setup() {
  pinMode(13, 1);
}
void loop() {
  digitalWrite(13, 1);
}`;
export const arduinoCycle = {
  version: 1,
  profile: "uml1-classic-v1",
  status: "diagram",
  kind: "activity",
  purpose:
    "Die einmalige Initialisierung und die wiederholte Ausführung der Sketch-Callbacks unterscheiden.",
  scope: ref(1, 6),
  runtime: "arduino-setup-loop",
  setup: {
    ref: ref(1, 3),
    body: [{ type: "action", code: "pinMode(13, 1);", ref: ref(2) }],
  },
  loop: {
    ref: ref(4, 6),
    body: [{ type: "action", code: "digitalWrite(13, 1);", ref: ref(5) }],
  },
};
