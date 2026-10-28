/*
 * IT05.4 – Ein Menü mit switch
 *
 * Lernziel:
 * Mit switch/case anhand einer eingegebenen Zahl einen von mehreren Fällen
 * auswählen und die Aufgabe von break und default erklären.
 *
 * Bezug zu den Unterlagen:
 * IT05, Folien „Mehrfachverzweigung - switch“ und „Mehrfachverzweigung -
 * Beispiel“ (Menübedienfunktion); IT03 „Serial.parseInt()“.
 *
 * Beobachtung:
 * Sende 1, 2 oder 3: LED an, LED aus oder Zustand anzeigen.
 * Jede andere Zahl ergibt „Unbekannte Auswahl“.
 */

const byte PIN_LED = 13;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  Serial.println("1 = LED an, 2 = LED aus, 3 = Zustand");
}

void loop() {
  int auswahl = Serial.parseInt();   // liefert 0, wenn nichts eingegeben wurde

  switch (auswahl) {
    case 0:
      break;                         // keine Eingabe: nichts tun
    case 1:
      digitalWrite(PIN_LED, HIGH);
      Serial.println("LED an");
      break;
    case 2:
      digitalWrite(PIN_LED, LOW);
      Serial.println("LED aus");
      break;
    case 3:
      Serial.print("LED-Zustand: ");
      Serial.println(digitalRead(PIN_LED));
      break;
    default:
      Serial.println("Unbekannte Auswahl");
      break;
  }
}

/*
 * Experimente:
 * 1. Sende 1, 3, 2, 3 und 7.
 * 2. Entferne das break nach Serial.println("LED an"); und sende 1.
 * 3. Ergänze einen Fall 4, der die LED umschaltet.
 *
 * Lernfragen:
 * 1. Wann wird der default-Zweig ausgeführt?
 * 2. Welche Aufgabe hat break?
 * 3. Warum gibt es einen eigenen Fall für 0?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine Menüauswahl mit switch/case umsetzen können."
  - "Sie sollen die Aufgaben von break und default erklären können."
afterFocus: free
focus:
  - id: faelle
    title: "Fälle und default"
    objective: "Erklären, welcher Fall bei einer Eingabe ausgeführt wird."
    questions:
      - kind: concept
        text: "Wann wird der `default`-Zweig ausgeführt?"
      - kind: concept
        text: "Warum gibt es einen eigenen Fall für den Wert 0 von `auswahl`?"
  - id: break
    title: "Die Aufgabe von break"
    objective: "Die Aufgabe von `break` erklären und das Durchfallen vorhersagen."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat `break` am Ende eines Falls?"
      - kind: prediction
        text: "Was geschieht, wenn nach dem Fall 1 das `break` fehlt und 1 gesendet wird?"
      - kind: transfer
        text: "Wie würdest du einen Fall ergänzen, der die LED an `PIN_LED` umschaltet?"
@end-unosim-tutor */
