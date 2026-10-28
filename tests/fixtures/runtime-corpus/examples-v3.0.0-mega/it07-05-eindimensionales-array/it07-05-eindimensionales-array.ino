/*
 * IT07.5 – Gleichartige Werte in einem Array speichern
 *
 * Lernziel:
 * Ein Array direkt initialisieren oder mit einer Schleife füllen und über
 * den Index auf seine Elemente zugreifen.
 *
 * Bezug zu den Unterlagen:
 * IT07, Folien „Array“, „Achtung: Der Index beginnt bei 0!“, „Direkte
 * Initialisierung“ und „Hier wird das Array mit einer Schleife gefüllt“.
 *
 * Beobachtung:
 * werte[2] ist 7. Danach erscheinen vier Zeitpunkte im Abstand von etwa 200 ms.
 */

byte werte[] = {23, 42, 7, 3};

const byte ANZAHL = 4;
unsigned long zeitpunkte[ANZAHL];

void setup() {
  Serial.begin(115200);

  Serial.print("werte[2] = ");
  Serial.println(werte[2]);

  for (byte i = 0; i < ANZAHL; i++) {
    zeitpunkte[i] = millis();
    delay(200);
  }

  for (byte i = 0; i < ANZAHL; i++) {
    Serial.print("zeitpunkte[");
    Serial.print(i);
    Serial.print("] = ");
    Serial.println(zeitpunkte[i]);
  }
}

void loop() {
}

/*
 * Experimente:
 * 1. Setze werte[0] = 99; und gib das Element danach aus.
 * 2. Ändere ANZAHL auf 6. An wie vielen Stellen musst du das Programm ändern?
 * 3. Ändere die zweite Schleifenbedingung in i <= ANZAHL. Was wird zusätzlich
 *    ausgegeben? (Der Wert ist zufällig – es wird außerhalb des Arrays gelesen.)
 *
 * Lernfragen:
 * 1. Mit welchem Index beginnt ein Array, mit welchem endet es?
 * 2. Warum muss die Schleifenbedingung i < ANZAHL lauten?
 * 3. Warum darf bei werte die Größe in den eckigen Klammern fehlen?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen ein eindimensionales Array anlegen, füllen und über den Index auslesen können."
afterFocus: free
focus:
  - id: index
    title: "Der Index"
    objective: "Den Startindex nennen und ein Element über seinen Index bestimmen."
    questions:
      - kind: recall
        text: "Mit welchem Index beginnt das Array `werte`, und mit welchem endet es?"
      - kind: application
        text: "Welchen Wert liefert `werte[2]`, und warum ist das nicht das zweite Element?"
  - id: schleife
    title: "Array und Schleife"
    objective: "Die Schleifenbedingung über das Array begründen und die Konstante `ANZAHL` nutzen."
    questions:
      - kind: concept
        text: "Warum muss die Bedingung `i < ANZAHL` lauten und darf nicht kleiner oder gleich sein?"
      - kind: concept
        text: "Welchen Vorteil hat es, dass `ANZAHL` sowohl die Größe von `zeitpunkte` als auch die Schleifengrenze festlegt?"
@end-unosim-tutor */
