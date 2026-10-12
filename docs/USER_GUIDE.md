# UnoSim benutzen

Diese Anleitung richtet sich an Lernende und Lehrkräfte, die UnoSim im Browser
verwenden. Installation und Betrieb beschreibt die
[Dokumentationsübersicht](README.md). Die Oberfläche
ist englisch; die Menünamen stehen hier deshalb in der Originalschreibweise.

## Überblick

UnoSim simuliert einen Arduino Uno im Browser. Du schreibst einen Sketch,
kompilierst ihn auf dem UnoSim-Server und siehst die Ausgabe im Serial Monitor
und am Board. Du brauchst dafür keine Hardware und keine Installation.

## Einen Sketch schreiben und starten

1. Den Code im Editor schreiben. Weitere Dateien legst du mit **File → New File**
   an; jede Datei erscheint als eigener Tab.
2. Mit **Start** in der Kopfzeile kompilieren und die Simulation starten.
   Fehler beim Kompilieren erscheinen im Output Panel unter dem Editor.
3. Ausgaben von `Serial.print` erscheinen im **Serial Monitor**. Eingaben an den
   Sketch schickst du über das Feld **Send to Arduino...**.
4. Das **Board** zeigt den Zustand der Pins. Einen als `INPUT` genutzten Pin
   schaltest du per Klick um; analoge Eingänge stellst du mit einem
   Schieberegler ein.
5. Mit **Pause** hältst du die Simulation an, um Pins in Ruhe zu prüfen oder zu
   verändern; mit **Resume** läuft sie weiter. **Stop** beendet den Lauf.

Ein Lauf endet automatisch nach seiner Laufzeit, die du unter
**Tools → Timeout** zwischen 5 Sekunden und 5 Minuten wählst. Eine pausierte
Simulation endet spätestens nach insgesamt 10 Minuten Pause.

## Arbeit sichern

Der Server speichert keine Sketches. Sichere deine Dateien mit
**File → Save All Files** und lade sie später mit **File → Load Files** wieder.

## Beispiele laden

**Examples** in der Kopfzeile (oder `Cmd/Ctrl+E`) öffnet die Beispielsammlung.
Ein Beispiel ersetzt nach Rückfrage den aktuellen Sketch.

Lehrkräfte können für ihren Browser eine eigene Beispielsammlung wählen:

1. **File → Settings** öffnen, Abschnitt **External Examples**.
2. Unter **Repository** ein öffentliches GitHub-Repository eintragen
   (`owner/repository` oder die GitHub-URL), unter **Ref** einen Branch oder
   Tag (Standard `main`).
3. **Validate** prüft die Sammlung, **Apply** übernimmt sie.
   **Reset to default** kehrt zur Sammlung des Servers zurück.

Die Auswahl gilt nur für diesen Browser und ändert nichts an der Einstellung
des Servers. Wie man eine eigene Sammlung samt Tutor-Inhalten aufbaut,
beschreibt das
[README von UnoSim-Examples](https://github.com/ttbombadil/UnoSim-Examples#course-content-and-tutor-authoring).

## Der Tutor

Der Tutor stellt Lernfragen zu deinem aktuellen Sketch und gibt Rückmeldung auf
deine Antworten. Er schreibt keine fertige Lösung.

### Tutor einschalten

Der Tutor ist Teil des neuen Arbeitsbereichs, der noch als experimentell gilt:

1. **File → Settings** öffnen.
2. Unter **Workspace & Interaction** die Option
   **Experimental Workspace Layout** einschalten.

Code, Simulation und Tutor erscheinen dann als eigene Spalten, die du einzeln
ein- und ausblenden kannst.

### API-Key eintragen

Der Tutor nutzt ein Sprachmodell über KI:connect.nrw und braucht dafür deinen
**persönlichen KI:connect-API-Key**. Den Key bekommst du über deine Schule oder
Hochschule.

1. In der Tutor-Spalte auf das Schlüssel-Symbol klicken
   (**API key missing**).
2. Den Key unter **API key** eintragen. Unter **Model** kannst du ein Modell
   wählen; **Automatic** ist die Voreinstellung.
3. Optional die **Start difficulty** setzen: 1 ist sehr leicht, 100 sehr schwer.
   Der Tutor passt die Schwierigkeit danach selbst an.

Der Key bleibt nur in diesem Browser-Tab im Arbeitsspeicher. Nach einem
Neuladen der Seite musst du ihn erneut eintragen. UnoSim speichert ihn nicht.

### Mit dem Tutor arbeiten

1. Mit dem Fragezeichen-Symbol in der Tutor-Spalte eine neue Lernfrage anfordern.
2. Die Antwort in das Feld **Your answer …** schreiben und mit
   **Send answer** abschicken.
3. Der Tutor bewertet dein Verständnis und stellt genau eine Folgefrage.

Stammt dein Sketch aus einer Beispielsammlung mit Tutor-Inhalten, folgt der
Tutor dem dort hinterlegten Lernpfad. Sonst – und auch, wenn GitHub gerade
nicht erreichbar ist – arbeitet er als freier Tutor direkt mit deinem Sketch.

## Einstellungen

Unter **File → Settings** findest du außerdem:

- **UI Font Size**: Schriftgröße von Oberfläche und Editor (S bis XXL),
- **Arduino Color**: Farbe des Boards,
- **Pin Monitor**: Pin-Übersicht über dem Board,
- **Toast Duration**: Anzeigedauer von Hinweisen.

## Wenn etwas nicht klappt

| Meldung oder Verhalten | Ursache und Lösung |
|---|---|
| **Server connection required** | Der Browser erreicht den UnoSim-Server nicht. Verbindung prüfen und die Seite neu laden. |
| **Waiting for compile slot** oder **Waiting for simulation slot** | Viele Nutzer kompilieren oder simulieren gleichzeitig; UnoSim startet deinen Lauf, sobald ein Platz frei ist. |
| **Enter your personal Tutor API key first.** | Es ist noch kein Key eingetragen, oder die Seite wurde neu geladen. |
| **The Tutor access was rejected.** | Der Key ist ungültig oder abgelaufen. |
| Fehler im Output Panel nach **Start** | Der Sketch kompiliert nicht. Die Zeilenangabe in der Meldung zeigt auf die Fehlerstelle. |
