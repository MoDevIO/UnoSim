# Funktionsbeschreibung: Auto-Behavior des Output Panels

## 1. Ziel der Funktion

Das **Output Panel** reagiert automatisch auf Compiler-Ergebnisse und Parser-Messages im Arduino-Simulator. Es öffnet, schließt oder passt seine Größe dynamisch an, um relevante Informationen sichtbar zu machen, ohne den Editor unnötig zu blockieren. Manuelle Benutzeraktionen (X-Button, Menü-Toggle) werden respektiert, jedoch bei neuen relevanten Ereignissen übersteuert.

---

## 2. Geltungsbereich

- **Komponente**: `arduino-simulator.tsx`
- **UI-Element**: Output Panel (Tabs: _Compiler_ / _Messages_)
- **Trigger**: Änderungen an Compiler-Output, Parser-Messages und Compile-Status
- **Nicht-Ziel**: Änderungen an bestehender UI-Struktur oder Breaking Changes

---

## 3. Automatisches Öffnen und Schließen

### 3.1 Compile-Fehler vorhanden

**Bedingung**  
 `hasCompilationErrors === true`

**Verhalten**  
 Das Output Panel MUSS automatisch sichtbar werden. Der aktive Tab MUSS „Compiler“ sein. Die Panel-Höhe MUSS dynamisch anhand der Fehlerlänge berechnet werden und innerhalb eines Bereichs von **25 % bis 75 %** der verfügbaren Viewport-Höhe liegen.

---

### 3.2 Parser-Messages ohne Compile-Fehler

**Bedingung**  
 `hasCompilationErrors === false`  
 `parserMessages.length > 0`

**Verhalten**  
 Das Output Panel MUSS automatisch sichtbar werden. Der aktive Tab MUSS „Messages“ sein. Die Panel-Höhe MUSS dynamisch anhand der Anzahl und Textlänge der Parser-Messages berechnet werden und innerhalb eines Bereichs von **25 % bis 75 %** liegen. Dabei sollen die Container, die die Messages enthalten komplett sichtbar sein, d.h. die Höhe dieser Container MUSS in der Berechnung der Höhe des Output-Panels verwendet werden.

---

### 3.3 Erfolgreicher Compile ohne Fehler und Messages

**Bedingung**  
 `success === true`  
 `hasCompilationErrors === false`  
 `parserMessages.length === 0`

**Verhalten**  
 Das Output Panel MUSS automatisch minimiert werden. Die Höhe MUSS auf **3 %** gesetzt werden (sichtbare Leiste). Das Panel DARF dabei nicht vollständig entfernt werden.

---

## 4. Größenberechnungslogik (verbindlich)

### 4.1 Compiler-Fehler

**Konstanten**  
 `HEADER_HEIGHT = 50px`  
 `PER_LINE = 20px`  
 `PADDING = 60px`  
 `AVAILABLE_HEIGHT = 800px`

**Berechnung**

```
lines = Anzahl der Zeilen im Fehlertext
chars = Anzahl der Zeichen im Fehlertext

effectiveLines = max(lines, ceil(chars / 80))
lineBasedPx = HEADER_HEIGHT + PADDING + effectiveLines * PER_LINE

panelSizePercent =
  min(75, max(25, ceil(lineBasedPx / AVAILABLE_HEIGHT * 100)))
```

---

### 4.2 Parser-Messages

**Konstanten**  
 `HEADER_HEIGHT = 50px`  
 `PER_MESSAGE_BASE = 55px`  
 `PADDING = 60px`  
 `AVAILABLE_HEIGHT = 800px`

**Berechnung**

```
count = parserMessages.length
totalLength = Summe aller Message-Zeichen

estimatedPx =
  HEADER_HEIGHT
  + PADDING
  + count * PER_MESSAGE_BASE
  + ceil(totalLength / 100) * 15

panelSizePercent =
  min(75, max(25, ceil(estimatedPx / AVAILABLE_HEIGHT * 100)))
```

---

## 5. Benutzerinteraktionen

### 5.1 X-Button (Schließen)

**Aktion**  
 Der Benutzer klickt auf den X-Button.

**Verhalten**  
 Das Output Panel wird geschlossen und ist nicht sichtbar.

**Regeln**  
 Bei neuen Compile-Fehlern MUSS das Panel automatisch wieder erscheinen.  
 Bei neuen Parser-Messages MUSS das Panel automatisch wieder erscheinen.  
 Bei erfolgreichem Compile ohne Probleme DARF das Panel geschlossen bleiben.

---

### 5.2 Menü-Eintrag „Output Panel“

**Ort**  
 Sketch-Menü

**Anforderungen**  
 Es MUSS exakt ein Menü-Eintrag mit dem Text „Output Panel“ existieren. Der Menü-Eintrag MUSS als Toggle (Ein/Aus) funktionieren. Wenn das Panel sichtbar ist, MUSS der Menü-Eintrag ein Häkchen (✓) anzeigen. Der Menü-Eintrag MUSS den aktuellen Sichtbarkeitsstatus manuell überschreiben können.

---

## 6. State- und Effect-Regeln

### 6.1 useEffect-Abhängigkeiten (verbindlich)

Der Auto-Behavior-Effect DARF ausschließlich von folgenden Werten abhängen:

```ts
[cliOutput, hasCompilationErrors, lastCompilationResult, parserMessages.length];
```

`showCompilationOutput` DARF NICHT Teil der Abhängigkeitsliste sein, da dies zu Zirkularabhängigkeiten führen würde.

---

## 7. Persistenz

Die Sichtbarkeit des Output Panels MUSS über `localStorage` persistiert werden. Manuelle Benutzerpräferenzen (Öffnen/Schließen) MÜSSEN über Seiten-Reloads hinweg erhalten bleiben. Automatische Re-Opens bei neuen Fehlern oder Parser-Messages haben Vorrang vor gespeicherten Benutzerpräferenzen.

---

## 8. Testanforderungen

Die Implementierung gilt nur als korrekt, wenn automatisierte Tests folgende Aspekte abdecken und erfolgreich sind:

**Unit-Tests**

- Größenberechnung für Compiler-Fehler und Parser-Messages
- Einhaltung der Grenzwerte (25 % / 75 %)
- Edge-Cases wie sehr lange Texte oder leere Messages

**Integration-Tests**

- Vollständige Compile-Workflows
- Verhalten des X-Buttons
- Menü-Toggle-Funktionalität
- Korrekte State-Transitions zwischen Erfolgs-, Warn- und Fehlerzuständen

---

## 9. Nicht-funktionale Anforderungen

Es dürfen keine Breaking Changes eingeführt werden. Das Verhalten MUSS responsiv sein. Die Auto-Logik MUSS klar von manueller Benutzersteuerung getrennt sein. Der Code MUSS produktionsreif und wartbar sein.

---

## 10. Akzeptanzkriterium

Die Funktion gilt als abgeschlossen, wenn alle beschriebenen Szenarien reproduzierbar funktionieren, das Output Panel deterministisch reagiert, die definierte Logik vollständig umgesetzt ist und alle automatisierten Tests erfolgreich durchlaufen.
