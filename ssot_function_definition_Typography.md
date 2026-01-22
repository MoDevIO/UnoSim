# Funktionsbeschreibung: Globale Schriftgrößensteuerung

## 1. Ziel der Funktion

Die **globale Schriftgröße** der Anwendung soll einheitlich über alle UI-Komponenten hinweg steuerbar sein. Benutzer können die Schriftgröße über einen Settings-Dialog oder über Tastenkürzel anpassen. Die gewählte Einstellung wird persistent gespeichert und bei jedem Start der Anwendung wiederhergestellt.

---

## 2. Geltungsbereich

- **Komponente**: Globale Anwendung
- **UI-Elemente**: Alle Text-Komponenten (Editor, Panels, Menüs, Dialoge, etc.)
- **Steuerelemente**: Settings-Dialog, Tastenkürzel
- **Bestehende Implementierung**: CSS-Variable `--ui-font-scale`, localStorage-basierte Persistierung
- **Nicht-Ziel**: Änderungen an bestehender UI-Struktur oder Breaking Changes

---

## 3. Schriftgrößen-Optionen

### 3.1 Verfügbare Größen

**Definition**  
Die Anwendung MUSS folgende Schriftgrößen unterstützen:

| Bezeichnung | Pixel-Wert | Scale-Faktor | Kurzbezeichnung |
|-------------|------------|--------------|-----------------|
| Klein       | 12px       | 0.875        | S               |
| Normal      | 14px       | 1.0          | M               |
| Groß        | 16px       | 1.125        | L               |
| Sehr groß   | 18px       | 1.25         | XL              |
| Extragroß   | 20px       | 1.5          | XXL             |

**Standard**  
Beim ersten Start der Anwendung MUSS die Schriftgröße „Normal" (14px, Scale 1.0, M) aktiv sein.

**Anzeige im UI**  
Die Settings-Dialog-Option MUSS sowohl die Kurzbezeichnung als auch den Pixel-Wert anzeigen (z.B. „S (12px)", „M (14px)").

---

## 4. Steuerung über Settings-Dialog

### 4.1 UI-Element

**Ort**  
Settings-Dialog der Anwendung

**Anforderungen**  
Es MUSS eine Auswahlbox (Dropdown/Select) mit der Bezeichnung „UI Font Scale" oder „Schriftgröße" existieren. Die Auswahlbox MUSS alle fünf verfügbaren Schriftgrößen im Format „Kurzbezeichnung (Pixel-Wert)" anzeigen (z.B. „M (14px)"). Die aktuell aktive Schriftgröße MUSS in der Auswahlbox vorausgewählt sein. Eine Änderung der Auswahl MUSS sofort angewendet werden.

### 4.2 Technische Umsetzung

**localStorage**  
Der gewählte Scale-Faktor MUSS im localStorage unter dem Key `uiFontScale` gespeichert werden.

**CSS-Variable**  
Die CSS-Variable `--ui-font-scale` MUSS mit dem gewählten Scale-Faktor aktualisiert werden.

**Event Dispatch**  
Nach jeder Änderung MUSS ein `uiFontScaleChange` Custom Event gefeuert werden.

---

## 5. Steuerung über Tastenkürzel

### 5.1 Schriftgröße erhöhen

**Tastenkombination**  
`CMD` + `+` (macOS) / `CTRL` + `+` (Windows/Linux)

**Verhalten**  
Die Schriftgröße MUSS zur nächstgrößeren verfügbaren Stufe wechseln (S→M→L→XL→XXL). Wenn bereits „XXL" (Extragroß) aktiv ist, DARF keine weitere Vergrößerung erfolgen. Die Änderung MUSS in localStorage gespeichert, die CSS-Variable aktualisiert und das `uiFontScaleChange` Event gefeuert werden.

---

### 5.2 Schriftgröße verringern

**Tastenkombination**  
`CMD` + `-` (macOS) / `CTRL` + `-` (Windows/Linux)

**Verhalten**  
Die Schriftgröße MUSS zur nächstkleineren verfügbaren Stufe wechseln (XXL→XL→L→M→S). Wenn bereits „S" (Klein) aktiv ist, DARF keine weitere Verkleinerung erfolgen. Die Änderung MUSS in localStorage gespeichert, die CSS-Variable aktualisiert und das `uiFontScaleChange` Event gefeuert werden.

---

### 5.3 Implementierungsdetails Tastenkürzel

**Event-Handler**  
Es MUSS ein globaler `keydown` Event-Handler registriert werden, der auf die Tastenkombinationen reagiert.

**Modifikatoren-Erkennung**  
Der Handler MUSS `event.metaKey` (macOS) bzw. `event.ctrlKey` (Windows/Linux) überprüfen.

**Event-Weiterleitung verhindern**  
Bei erkannter Tastenkombination MUSS `event.preventDefault()` aufgerufen werden, um Browser-Standard-Zoom zu verhindern.

---

## 6. Anwendungsverhalten

### 6.1 Globale Konsistenz

**Anforderung**  
Die gewählte Schriftgröße MUSS auf alle Text-Elemente der Anwendung angewendet werden. Dies umfasst:

- Code-Editor
- Output Panel
- Menüs
- Dialoge
- Statusleisten
- Alle sonstigen UI-Komponenten mit Text

**CSS-Implementierung**  
Alle font-size und line-height Werte in `index.css` MÜSSEN mit `calc(Basis-Wert * var(--ui-font-scale))` berechnet werden.

**Ausnahmen**  
Es DÜRFEN keine Ausnahmen existieren. Die Schriftgröße MUSS überall identisch skaliert sein.

---

### 6.2 Sofortige Anwendung

**Verhalten**  
Änderungen der Schriftgröße (über Dialog oder Tastenkürzel) MÜSSEN sofort sichtbar werden, ohne dass ein Reload der Anwendung erforderlich ist. Dies wird durch die direkte Manipulation der CSS-Variable `--ui-font-scale` erreicht.

---

## 7. Persistenz

### 7.1 Speicherung

**Anforderung**  
Der gewählte Scale-Faktor MUSS über `localStorage` unter dem Key `uiFontScale` persistiert werden.

**Format**  
Der gespeicherte Wert MUSS ein numerischer Scale-Faktor sein (0.875, 1.0, 1.125, 1.25, 1.5).

---

### 7.2 Wiederherstellung

**Ort**  
`main.tsx` beim App-Start

**Verhalten**  
Beim Start der Anwendung MUSS der gespeicherte Scale-Faktor aus `localStorage` geladen und die CSS-Variable `--ui-font-scale` entsprechend gesetzt werden. Falls kein Wert gespeichert ist, MUSS der Standard-Scale-Faktor 1.0 (Normal, 14px) verwendet werden.

---

## 8. State-Management

### 8.1 Aktuelle Implementierung

**Verfahren**  
Die Schriftgröße wird aktuell NICHT über React Context oder Redux verwaltet, sondern ausschließlich über:

- localStorage (`uiFontScale`)
- CSS-Variable (`--ui-font-scale`)
- Custom Event (`uiFontScaleChange`)

**Begründung**  
Dieser Ansatz ist ausreichend, da CSS-Variablen global wirken und keine React-Re-Renders erforderlich sind.

---

### 8.2 Tastenkürzel-Handler

**Registration**  
Der globale `keydown` Event-Listener MUSS in `main.tsx` oder einem entsprechenden frühen Initialisierungspunkt registriert werden.

**Scope**  
Der Handler MUSS auf `document` oder `window` Ebene registriert werden, um global zu wirken.

**Cleanup**  
Bei Bedarf (z.B. bei Hot-Reloading in Entwicklungsumgebung) MUSS der Event-Listener korrekt entfernt werden.

---

## 9. Testanforderungen

Die Implementierung gilt nur als korrekt, wenn automatisierte Tests folgende Aspekte abdecken und erfolgreich sind:

**Unit-Tests**

- Korrekte Umrechnung zwischen Schriftgrößen-Kurzbezeichnungen (S/M/L/XL/XXL) und Scale-Faktoren
- Persistierung und Wiederherstellung aus `localStorage`
- Grenzwert-Tests (keine Vergrößerung über XXL, keine Verkleinerung unter S)
- Event-Dispatch bei Änderungen

**Integration-Tests**

- Änderung über Settings-Dialog funktioniert und aktualisiert localStorage und CSS-Variable
- Tastenkürzel `CMD/CTRL` + `+` funktioniert und erhöht die Schriftgröße
- Tastenkürzel `CMD/CTRL` + `-` funktioniert und verringert die Schriftgröße
- CSS-Variable wird korrekt angewendet und alle UI-Komponenten reagieren
- Reload der Anwendung stellt gespeicherte Schriftgröße wieder her
- Browser-Standard-Zoom wird durch `preventDefault()` korrekt verhindert

---

## 10. Nicht-funktionale Anforderungen

Es dürfen keine Breaking Changes an der bestehenden CSS-Variable-basierten Implementierung eingeführt werden. Die Schriftgrößen-Änderung MUSS performant sein und DARF keine merklichen Verzögerungen verursachen. Der Code MUSS produktionsreif und wartbar sein. Die Tastenkürzel MÜSSEN plattformübergreifend funktionieren (macOS, Windows, Linux). Die Pixel-Werte MÜSSEN im UI sichtbar sein, um Transparenz für den Benutzer zu schaffen.

---

## 11. Implementierungs-Roadmap

### Phase 1: Tastenkürzel (Priority: HIGH)

- Globalen `keydown` Event-Handler implementieren
- Logik für Erhöhen/Verringern der Scale-Stufe
- localStorage-Update und CSS-Variable-Update
- Event-Dispatch `uiFontScaleChange`
- Browser-Zoom-Verhinderung via `preventDefault()`

### Phase 2: UI-Verbesserung (Priority: MEDIUM)

- Settings-Dialog anpassen: Anzeige von „S (12px)" statt nur „S"
- Dokumentation der Pixel-Zuordnung im UI

### Phase 3: Testing (Priority: HIGH)

- Unit-Tests für Tastenkürzel-Logik
- Integration-Tests für kompletten Workflow
- End-to-End-Tests für Persistierung

---

## 12. Nachweis der Schriftgrößen-Konsistenz (verbindlich)

### 12.1 Anforderung

Vor Abnahme der Implementierung MUSS ein vollständiger Nachweis erbracht werden, dass die Schriftgröße in allen UI-Komponenten konsistent angewendet wird.

### 12.2 Schritt 1: Automatisierte Messung mit Python-Skript

**Primäre Methode: Automatisches Messskript (EMPFOHLEN)**

Es MUSS ein Python-Skript mit Selenium/Playwright erstellt werden, das:

**A) Funktionsumfang**
- Die Anwendung im Browser öffnet (z.B. `http://localhost:5173`)
- Für alle 5 Schriftgrößen (S/M/L/XL/XXL):
  - Die Schriftgröße über Settings-Dialog setzt
  - Alle definierten UI-Komponenten durchläuft
  - Den computed `font-size` Wert per JavaScript ausliest
  - Erwartet vs. Gemessen vergleicht
  - Abweichungen dokumentiert

**B) Konfiguration**
Eine `font_selectors.json` Datei MUSS alle zu prüfenden Komponenten definieren:
```json
{
  "components": [
    {
      "name": "Code-Editor",
      "selector": ".monaco-editor .view-line",
      "wait_for": ".monaco-editor"
    },
    {
      "name": "Compiler-Output",
      "selector": ".compiler-output pre",
      "trigger_action": "compile"
    },
    ...
  ]
}
```

**C) Output-Formate**
Das Skript MUSS folgende Reports generieren:
- `font_size_report_DATUM.md` - Markdown-Tabelle für Menschen
- `font_size_report_DATUM.csv` - CSV für weitere Verarbeitung
- Exitcode 0 bei Erfolg, 1 bei Inkonsistenzen (für CI/CD)

**D) Installationsanforderungen**
```bash
pip install selenium webdriver-manager
python measure_font_sizes.py --url http://localhost:5173
```

**Sekundäre Methode: Manuelle Codebase-Analyse**

Falls automatische Messung nicht möglich, MUSS eine manuelle Analyse erfolgen:

**A) CSS-Dateien durchsuchen**
```bash
# Alle font-size Vorkommen finden
grep -rn "font-size" src/ --include="*.css" --include="*.scss"
grep -rn "var(--fs-" src/ --include="*.css" --include="*.scss"
```

**B) React-Komponenten durchsuchen**
```bash
# Inline-Styles mit fontSize finden
grep -rn "fontSize" src/ --include="*.tsx" --include="*.jsx"
```

**C) CSS-Variablen-Definitionen prüfen**
Suche in `index.css` nach allen `--fs-*` Variablen und prüfe, ob sie `var(--ui-font-scale)` verwenden oder hardcoded sind.

### 12.3 Schritt 2: Nachweisdokument erstellen

Basierend auf der Identifikation aus Schritt 1 MUSS ein Dokument (z.B. Markdown-Tabelle oder Spreadsheet) erstellt werden mit folgenden Spalten:

| Komponente | CSS-Selektor/Klasse | Gemessen (M=14px) | Erwartet | Status | Datei | Zeile | Problem | Fix |
|------------|---------------------|-------------------|----------|--------|-------|-------|---------|-----|
| Code-Editor | `.monaco-editor .view-line` | 14px | 14px | ✓ | - | - | - | - |
| Compiler-Output | `.compiler-output pre` | 16px | 14px | ✗ | CompilerOutput.css | 42 | Nutzt `var(--fs-md)` statt Scale | Ersetze durch `calc(14px * var(--ui-font-scale))` |
| Serieller Monitor | `.serial-monitor` | 12px | 14px | ✗ | SerialMonitor.css | 28 | Nutzt `var(--fs-sm)` statt Scale | Ersetze durch `calc(14px * var(--ui-font-scale))` |

### 12.3 Komponenten-Liste (Mindestumfang)

Folgende Komponenten MÜSSEN im Nachweis enthalten sein (diese Liste ist NICHT vollständig - siehe Schritt 1 für vollständige Identifikation):

**Editor-Bereich**
- Code-Editor (Monaco Editor)
- Zeilennummern
- Code-Completion-Popup

**Output-Bereich**
- Compiler-Output-Panel
- Compiler-Fehler-Meldungen
- Compiler-Warnungen

**Monitor-Bereich**
- Serieller Monitor
- Monitor-Eingabefeld
- Monitor-Ausgabe

**Navigation & Menüs**
- Hauptmenü
- Kontextmenüs
- Dropdown-Menüs
- Sketch-Liste

**Dialoge**
- Settings-Dialog
- Bestätigungsdialoge
- Fehlerdialoge

**Status & Info**
- Statusleiste
- Tooltips
- Inline-Hilfe-Texte

**Sonstige**
- Button-Beschriftungen
- Tab-Beschriftungen
- Placeholder-Texte in Eingabefeldern

### 12.4 Schritt 3: Messung und Verifikation

**Werkzeug**  
Browser DevTools (Chrome/Firefox/Safari)

**Vorgehen**
1. Setze Schriftgröße auf „M (14px)" (Scale 1.0)
2. Öffne DevTools → Inspector/Elements
3. Für jede in Schritt 1 identifizierte Komponente:
   - Öffne die entsprechende UI-Komponente in der Anwendung
   - Markiere das Text-Element im Inspector
   - Lese den **computed value** von `font-size` ab (nicht den Style-Wert!)
   - Dokumentiere in der Tabelle aus 12.3
   - Bei Abweichung: Prüfe im "Computed"-Tab, welche CSS-Regel den Wert setzt
4. Wiederhole für mindestens eine weitere Größe (z.B. „L (16px)")

**Wichtig: Computed vs. Declared**
- **Declared**: Was im CSS steht (z.B. `calc(14px * var(--ui-font-scale))`)
- **Computed**: Was tatsächlich gerendert wird (z.B. `14px`)
- Für den Nachweis zählt nur der **Computed**-Wert!

**Beispiel-Vorgehen am Compiler-Output:**
1. Öffne die App, klicke auf "Compile"
2. Rechtsklick auf eine Zeile im Compiler-Output → "Inspect"
3. Im Inspector: Suche das Text-Element (z.B. `<pre>` oder `<div>`)
4. Im "Computed"-Tab: Scrolle zu `font-size`
5. Lese Wert ab: z.B. `16px` (erwartet wären `14px` bei M)
6. Im "Styles"-Tab: Identifiziere die Regel, die `font-size` setzt
7. Dokumentiere: Datei, Zeile, Problem

### 12.5 Schritt 4: Root-Cause-Analyse und Fixes

**Akzeptanzkriterium pro Komponente**  
Die gemessene `font-size` MUSS exakt dem erwarteten Wert entsprechen (bei M: 14px, bei L: 16px, etc.). Abweichungen von mehr als 0.5px sind NICHT akzeptabel.

**Häufige Ursachen für Inkonsistenzen:**

**A) Verwendung von `--fs-*` Variablen statt `--ui-font-scale`**
```css
/* ❌ FALSCH - hardcoded, skaliert nicht */
.compiler-output {
  font-size: var(--fs-md); /* = 16px fix */
}

/* ✓ RICHTIG - skaliert mit Benutzereinstellung */
.compiler-output {
  font-size: calc(14px * var(--ui-font-scale));
}
```

**B) Hardcoded px-Werte**
```css
/* ❌ FALSCH */
.serial-monitor {
  font-size: 12px;
}

/* ✓ RICHTIG */
.serial-monitor {
  font-size: calc(14px * var(--ui-font-scale));
}
```

**C) Fehlende Vererbung in CSS-Klassen**
```css
/* Problem: Basis-Klasse nutzt Scale, aber Unterklasse überschreibt */
.panel { font-size: calc(14px * var(--ui-font-scale)); }
.panel .content { font-size: 16px; } /* ❌ Überschreibt! */
```

**Fix-Dokumentation**

Bei jeder identifizierten Abweichung MUSS dokumentiert werden:
- Dateiname und Zeilennummer der CSS-Regel
- Art der Abweichung (hardcoded value, falsche Variable, missing scale, inline-style)
- Konkreter Fix-Vorschlag mit Code-Beispiel
- Komponenten-Name zur Verifizierung nach Fix

**Beispiel-Dokumentation**
```markdown
### Fix 1: Compiler-Output
- **Problem**: Nutzt `var(--fs-md)` (16px fix) statt skalierbare Größe
- **Datei**: `src/components/CompilerOutput.css`, Zeile 42
- **Aktuell**: `font-size: var(--fs-md);`
- **Fix**: `font-size: calc(14px * var(--ui-font-scale));`
- **Verifizierung**: Nach Fix `measure_font_sizes.py` erneut ausführen
```

**Workflow nach Fixes**
1. Fixes in Code anwenden
2. Python-Skript erneut ausführen: `python measure_font_sizes.py`
3. Prüfen: Alle Komponenten Status ✓?
4. Falls nein: Root-Cause-Analyse wiederholen
5. Falls ja: Abschnitt 13 (Akzeptanzkriterium) erfüllt

---

## 13. Akzeptanzkriterium

Die Funktion gilt als abgeschlossen, wenn:

**Funktionale Anforderungen:**
- Alle fünf Schriftgrößen über den Settings-Dialog auswählbar sind und im Format „Kurzbezeichnung (Pixel)" angezeigt werden
- Tastenkürzel `CMD/CTRL` + `+` und `CMD/CTRL` + `-` funktionieren und die Schriftgröße entsprechend ändern
- Die Schriftgröße überall in der Anwendung einheitlich über `--ui-font-scale` angewendet wird
- Die gewählte Einstellung über Seiten-Reloads hinweg aus localStorage wiederhergestellt wird
- Browser-Standard-Zoom durch die Tastenkürzel verhindert wird
- Ein `uiFontScaleChange` Event bei jeder Änderung gefeuert wird

**Nachweis-Anforderungen (KRITISCH):**
- Das Python-Messskript (`measure_font_sizes.py`) wurde erstellt und läuft fehlerfrei
- Das Messskript wurde für ALLE 5 Schriftgrößen (S/M/L/XL/XXL) ausgeführt
- Der generierte Report (`font_size_report_DATUM.md`) zeigt für ALLE gemessenen Komponenten den Status ✓
- KEINE Abweichungen > 0.5px existieren
- Alle identifizierten Fixes wurden implementiert und verifiziert

**Test-Anforderungen:**
- Alle automatisierten Tests erfolgreich durchlaufen
- Mindestens ein End-to-End-Test mit dem Python-Messskript ist in CI/CD integriert

**Dokumentations-Anforderungen:**
- `README_FONT_MEASUREMENT.md` mit Anleitung zur Verwendung des Messskripts existiert
- `font_selectors.json` dokumentiert alle geprüften Komponenten
- Aktueller Mess-Report mit Datum liegt vor und zeigt 100% Konsistenz