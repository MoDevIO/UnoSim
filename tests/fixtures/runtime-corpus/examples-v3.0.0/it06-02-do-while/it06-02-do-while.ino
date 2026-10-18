/*
 * IT06.2 – Eine fußgesteuerte Schleife
 *
 * Lernziel:
 * Mit do/while einen Block mindestens einmal ausführen und erst danach die
 * Bedingung prüfen.
 *
 * Bezug zu den Unterlagen:
 * IT06, Folien „Fußgesteuerte Schleife“ und „Fußgesteuerte Schleife –
 * do {} while“; Übung LED-Würfel.
 *
 * Beobachtung:
 * Es wird so lange gewürfelt, bis eine 6 fällt. Mindestens ein Wurf findet
 * immer statt. Danach steht die Zahl der Versuche im Monitor.
 * random(1, 7) liefert eine Zufallszahl von 1 bis 6.
 */

void setup() {
  Serial.begin(115200);

  byte wurf;
  byte versuche = 0;

  do {
    wurf = random(1, 7);
    versuche++;
    Serial.print("Wurf: ");
    Serial.println(wurf);
  } while (wurf != 6);

  Serial.print("Versuche bis zur 6: ");
  Serial.println(versuche);
}

void loop() {
}

/*
 * Experimente:
 * 1. Würfle so lange, bis eine 1 fällt.
 * 2. Schreibe die Schleife als while-Schleife mit derselben Bedingung und
 *    setze wurf vorher auf 6. Wie oft wird jetzt gewürfelt?
 * 3. Verschiebe den Würfelvorgang nach loop() und ergänze delay(2000);.
 *
 * Lernfragen:
 * 1. Wann wird die Bedingung einer do/while-Schleife geprüft?
 * 2. Wie oft wird ihr Block mindestens ausgeführt?
 * 3. Warum passt eine fußgesteuerte Schleife gut zum Würfeln?
 */

/* @unosim-tutor
schemaVersion: 2
learningObjectives:
  - "Die Studierenden sollen eine fußgesteuerte Schleife mit do/while einsetzen und von while unterscheiden können."
afterFocus: free
focus:
  - id: pruefung-am-ende
    title: "Prüfung am Ende"
    objective: "Erklären, wann die Bedingung geprüft wird und wie oft der Block mindestens läuft."
    questions:
      - kind: concept
        text: "Wann wird die Bedingung `wurf != 6` geprüft?"
      - kind: recall
        text: "Wie oft wird der Block der `do`-Schleife mindestens ausgeführt?"
  - id: vergleich-while
    title: "Vergleich mit while"
    objective: "Das Verhalten von do/while und while bei gleicher Bedingung vergleichen."
    questions:
      - kind: prediction
        text: "Wie oft wird gewürfelt, wenn eine `while`-Schleife mit derselben Bedingung verwendet wird und `wurf` vorher den Wert 6 hat?"
      - kind: concept
        text: "Warum passt eine fußgesteuerte Schleife gut zum Würfeln bis zur 6?"
@end-unosim-tutor */
