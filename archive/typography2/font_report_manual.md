# Font Size Measurement Report (Manual Code Analysis)

**Datum:** 2026-01-22

**Status:** Automatische Messung fehlgeschlagen (Server-Verbindungsprobleme mit Selenium/ChromeDriver)

**Methode:** Code-Analyse + Screenshot-Verifizierung

---

## Zusammenfassung

Die Analyse zeigt **KRITISCHE INKONSISTENZEN** in der Schriftgrößenimplementierung:

### Hauptproblem (nachgewiesen durch Screenshot)
- **Serieller Monitor** (oben rechts): Schrift ist **kleiner** als erwartet
- **Compiler-Output** (unten links): Schrift entspricht erwarteter Größe

Dies verletzt die SSOT-Anforderung: "Die Schriftgröße MUSS überall identisch skaliert sein."

---

## Code-Analyse: Identifizierte Probleme

### 1. **Serieller Monitor - Inconsistent**
**Problem:** Der serielle Monitor verwendet möglicherweise andere CSS-Klassen oder eigene Styles, die nicht die zentrale `--ui-font-scale` Variable nutzen.

**Verdächtige Stellen:**
- Komponente: `SerialMonitor.tsx`
- Fehlende Selektor-Definition in den gefundenen CSS-Dateien
- Wahrscheinlich: Inline-Styles oder separate CSS-Datei

**Empfohlene Messung:**
```
DevTools → Inspect "Serial output will appear here..."
Computed Tab → font-size: ?? px (sollte 14px bei M sein)
Styles Tab → Quelle der CSS-Regel dokumentieren
```

**Erwarteter Fix:**
```css
.serial-monitor, .serial-output {
  font-size: var(--ui-font-size) !important;
  line-height: var(--ui-line-height) !important;
}
```

---

### 2. **Compiler-Output - Vermutlich korrekt**
**Analyse:** Nutzt `.console-output` Klasse aus `index.css`:
```css
.console-output {
  font-size: var(--fs-md);  /* = 16px fixed, NICHT skaliert! */
  line-height: var(--lh-md);
}
```

**Problem:** `--fs-md` ist auf `16px` fixiert, nutzt NICHT `--ui-font-scale`!

**Erwarteter Fix:**
```css
.console-output {
  font-size: var(--ui-font-size);
  line-height: var(--ui-line-height);
}
```

---

### 3. **Monaco Editor - Status unklar**
- Keine expliziten font-size-Definitionen im Code gefunden
- Monaco hat eigene Konfiguration (JavaScript)
- Vermutlich über `inherit` skaliert, muss geprüft werden

---

## Detaillierte Fundstellen (Code)

| Komponente | CSS-Selektor | Datei | Zeile | Verwendet --ui-font-scale? | Problem |
|------------|--------------|-------|-------|---------------------------|---------|
| Compiler-Output | `.console-output` | index.css | 174 | ❌ Nein | Nutzt `--fs-md` (16px fix) statt `--ui-font-size` |
| Body | `body` | index.css | 105 | ❌ Nein | Nutzt `--fs-md` (16px fix) |
| Buttons | `button`, `.btn` | index.css | 292 | ✅ Ja | Korrekt: `var(--ui-control-font-size)` |
| Text UI Klassen | `.text-ui-*` | index.css | 249-266 | ✅ Ja | Korrekt: `var(--ui-font-size)` |
| Tabs | `.text-ui-sm` | sketch-tabs.tsx | 391 | ✅ Ja | Korrekt: `var(--ui-control-font-size)` |
| Input | `.text-ui-md` | input-group.tsx | 46 | ✅ Ja | Korrekt: `var(--ui-font-size)` |
| Arduino Board SVG | SVG `<text>` | arduino-board.tsx | 402 | ❌ Nein | Hardcoded: `font-size="8"` (aber SVG, okay laut SSOT) |
| Headers h1-h6 | `h1`, `h2`, etc. | index.css | 110+ | ❌ Nein | Nutzen `--fs-*xl` (fix), aber ok für Headers |

---

## Kritische Fixes erforderlich

### Fix 1: Compiler-Output
**Datei:** `client/src/index.css`, Zeile 174

**Von:**
```css
.console-output {
  font-family: var(--font-mono);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  background: var(--background);
  color: hsl(0 0% 85%);
  white-space: pre-wrap;
  word-wrap: break-word;
}
```

**Zu:**
```css
.console-output {
  font-family: var(--font-mono);
  font-size: var(--ui-font-size);
  line-height: var(--ui-line-height);
  background: var(--background);
  color: hsl(0 0% 85%);
  white-space: pre-wrap;
  word-wrap: break-word;
}
```

---

### Fix 2: Body-Element
**Datei:** `client/src/index.css`, Zeile 105

**Von:**
```css
body {
  @apply font-sans antialiased bg-background text-foreground;
  font-family: var(--font-sans);
  font-size: var(--fs-md);
  line-height: var(--lh-md);
}
```

**Zu:**
```css
body {
  @apply font-sans antialiased bg-background text-foreground;
  font-family: var(--font-sans);
  font-size: var(--ui-font-size);
  line-height: var(--ui-line-height);
}
```

---

### Fix 3: Alle --fs-* Variablen skalierbar machen
**Datei:** `client/src/index.css`, Zeile 43-57

**Von:**
```css
--fs-xs: 16px;
--fs-sm: 16px;
--fs-md: 16px;
--fs-lg: 16px;
--fs-xl: 16px;
--fs-2xl: 24px;
--fs-3xl: 30px;
```

**Zu:**
```css
--fs-xs: calc(14px * var(--ui-font-scale));
--fs-sm: calc(14px * var(--ui-font-scale));
--fs-md: calc(14px * var(--ui-font-scale));
--fs-lg: calc(14px * var(--ui-font-scale));
--fs-xl: calc(16px * var(--ui-font-scale));
--fs-2xl: calc(24px * var(--ui-font-scale));
--fs-3xl: calc(30px * var(--ui-font-scale));
```

---

## Nächste Schritte

1. **Manuelle Browser-Messung durchführen:**
   - App öffnen: http://localhost:3001
   - Settings auf "M (14px)" stellen
   - DevTools (F12) öffnen
   - Für jede Komponente: Computed font-size ablesen
   - Dokumentieren in dieser Tabelle

2. **Fixes anwenden:**
   - Fix 1-3 in `index.css` umsetzen
   - Seriellen Monitor untersuchen und fixen

3. **Automatisches Skript erneut ausführen:**
   - Nach Fixes das Selenium-Skript erneut laufen lassen
   - Alle Komponenten sollten dann ✓ Status haben

4. **Tests schreiben:**
   - Unit-Tests für Scale-Faktoren
   - Integration-Tests für UI-Konsistenz

---

## Akzeptanzkriterium (noch nicht erfüllt)

❌ **Die Funktion kann NICHT abgenommen werden**, da:
- Inkonsistenzen in der Schriftgröße nachgewiesen sind (Screenshot)
- `--fs-md` und andere Variablen nicht skalieren
- Compiler-Output hardcoded 16px nutzt
- Serieller Monitor offensichtlich andere Größe hat
- Automatische Messung nicht durchgeführt werden konnte

---

## Empfehlung

**PRIORITY HIGH:** Fixes 1-3 sofort umsetzen, dann manuelle Messung durchführen und dokumentieren.
