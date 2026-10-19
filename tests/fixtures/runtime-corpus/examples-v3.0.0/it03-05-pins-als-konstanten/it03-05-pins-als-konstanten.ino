/*
 * IT03.5 – Pin-Nummern als Konstanten
 *
 * Lernziel:
 * Pin-Nummern einmal zentral als Konstanten festlegen – mit const oder mit
 * der Präprozessoranweisung #define.
 *
 * Bezug zu den Unterlagen:
 * IT03, Folien „Konstanten“, „Konstanten für verwendete Pins“ und
 * „Konstanten für verwendete Pins - Beispiel“ (3 LEDs).
 *
 * Beobachtung:
 * Die LEDs an den Pins 5, 6 und 7 leuchten nacheinander auf (Lauflicht).
 */

const byte PIN_LED1 = 5;
const byte PIN_LED2 = 6;
#define PIN_LED3 7             // ohne = und ohne ; – wird vor dem Compilieren ersetzt
const int WARTEZEIT = 300;     // ms

void setup() {
  pinMode(PIN_LED1, OUTPUT);
  pinMode(PIN_LED2, OUTPUT);
  pinMode(PIN_LED3, OUTPUT);
}

void loop() {
  digitalWrite(PIN_LED1, HIGH);
  delay(WARTEZEIT);
  digitalWrite(PIN_LED1, LOW);

  digitalWrite(PIN_LED2, HIGH);
  delay(WARTEZEIT);
  digitalWrite(PIN_LED2, LOW);

  digitalWrite(PIN_LED3, HIGH);
  delay(WARTEZEIT);
  digitalWrite(PIN_LED3, LOW);
}

/*
 * Experimente:
 * 1. Schließe die zweite LED an Pin 8 an. An wie vielen Stellen musst du
 *    das Programm ändern?
 * 2. Schreibe #define PIN_LED3 = 7; und lies die Fehlermeldung.
 * 3. Ergänze eine vierte LED und lasse das Licht auch zurücklaufen.
 *
 * Lernfragen:
 * 1. Welchen Vorteil haben Konstanten für Pin-Nummern?
 * 2. Was macht der Präprozessor mit PIN_LED3 vor dem Compilieren?
 * 3. Warum steht bei #define kein = und kein ;?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen Pin-Nummern als Konstanten festlegen und den Nutzen begründen können."
  - "Sie sollen `const` und `#define` unterscheiden können."
afterFocus: free
focus:
  - id: nutzen
    title: "Nutzen von Konstanten"
    objective: "Begründen, warum Pin-Nummern als Konstanten festgelegt werden."
    questions:
      - kind: application
        text: "An wie vielen Stellen musst du das Programm ändern, wenn `PIN_LED2` an einem anderen Pin angeschlossen wird?"
      - kind: concept
        text: "Warum ist `digitalWrite(PIN_LED1, HIGH)` besser lesbar als eine Zeile mit der Zahl 5?"
  - id: const-und-define
    title: "const und #define"
    objective: "Die Arbeitsweise von `#define` beschreiben und von `const` abgrenzen."
    questions:
      - kind: concept
        text: "Was macht der Präprozessor mit `PIN_LED3`, bevor compiliert wird?"
      - kind: prediction
        text: "Was geschieht, wenn in der Zeile mit `#define` ein Gleichheitszeichen und ein Semikolon ergänzt werden?"
@end-unosim-tutor */
