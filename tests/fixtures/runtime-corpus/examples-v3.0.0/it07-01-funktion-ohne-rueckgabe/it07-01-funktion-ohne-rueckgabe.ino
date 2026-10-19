/*
 * IT07.1 – Wiederkehrende Abläufe in Funktionen bündeln
 *
 * Lernziel:
 * Wiederholte Anweisungen in void-Funktionen zusammenfassen und diese
 * mehrfach aufrufen.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Bedarf“, „Funktion als UML-Aktivitätsdiagramm“ (dit, dah,
 * Buchstaben morsen) und „Funktion“ (Syntax); Morse-Übung.
 *
 * Beobachtung:
 * Die LED an Pin 13 morst SOS. Gleichzeitig erscheint im Monitor „... --- ...“.
 */

const byte PIN_LED = 13;
const int DIT = 200;                    // ms
const int DAH = 3 * DIT;
const int PAUSE_SYMBOL = DIT;
const int PAUSE_BUCHSTABE = 3 * DIT;

void signalAusgeben(int dauer) {
  digitalWrite(PIN_LED, HIGH);
  delay(dauer);
  digitalWrite(PIN_LED, LOW);
  delay(PAUSE_SYMBOL);
}

void ditAusgeben() {
  Serial.print(".");
  signalAusgeben(DIT);
}

void dahAusgeben() {
  Serial.print("-");
  signalAusgeben(DAH);
}

void morseS() {
  ditAusgeben();
  ditAusgeben();
  ditAusgeben();
  Serial.print(" ");
  delay(PAUSE_BUCHSTABE);
}

void morseO() {
  dahAusgeben();
  dahAusgeben();
  dahAusgeben();
  Serial.print(" ");
  delay(PAUSE_BUCHSTABE);
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  morseS();
  morseO();
  morseS();
  Serial.println();
  delay(2000);
}

/*
 * Experimente:
 * 1. Ändere DIT auf 100. An wie vielen Stellen musst du das Programm ändern?
 * 2. Schreibe eine Funktion morseH() (vier dit) und morse HO.
 * 3. Rufe in loop() statt morseO() dreimal dahAusgeben() auf. Was fehlt dann?
 *
 * Lernfragen:
 * 1. Wann werden die Anweisungen in einer Funktion ausgeführt?
 * 2. Welche Bedeutung hat der Rückgabetyp void?
 * 3. Welchen Vorteil hat es, dass ditAusgeben() und dahAusgeben() dieselbe
 *    Funktion signalAusgeben() verwenden?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen wiederkehrende Abläufe in Funktionen ohne Rückgabe bündeln können."
  - "Sie sollen Funktionsdefinition, Funktionsaufruf und Parameter unterscheiden können."
afterFocus: free
focus:
  - id: definition-und-aufruf
    title: "Definition und Aufruf"
    objective: "Definition und Aufruf unterscheiden und erklären, wann der Funktionskörper läuft."
    questions:
      - kind: concept
        text: "Welcher Teil ist die Definition und welcher der Aufruf von `morseS`?"
      - kind: concept
        text: "Welche Bedeutung hat der Rückgabetyp `void` bei `ditAusgeben`?"
  - id: parameter
    title: "Parameter"
    objective: "Die Aufgabe des Parameters `dauer` erklären."
    questions:
      - kind: concept
        text: "Welche Aufgabe hat der Parameter `dauer` in `signalAusgeben`?"
      - kind: prediction
        text: "Wie ändert sich der Ablauf, wenn `DIT` auf 100 gesetzt wird?"
      - kind: transfer
        text: "Wie würdest du eine Funktion für den Buchstaben H schreiben?"
@end-unosim-tutor */
