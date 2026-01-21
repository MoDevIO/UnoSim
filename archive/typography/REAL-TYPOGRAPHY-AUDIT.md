# Echte Typography Bestandsaufnahme

## PROBLEM-ÜBERSICHT

Die Schriftgrößen sind NICHT vereinheitlicht. Hier die tatsächlichen Werte aus dem Code:

## OUTPUT FENSTER

### Serial Monitor

- Container: `text-ui-xs font-mono` (12px, monospace) ✓ KORREKT

### Compilation Output

- Container: `.console-output p-3 font-mono`
- **PROBLEM**: Nutzt CSS-Klasse `.console-output` mit `font-size: var(--fs-sm)` = **14px**
- **NICHT** text-ui-xs!

### Parser Output

- Header: `text-ui-sm` (14px) ✓
- Tab Buttons: `text-ui-xs` (12px) ✓
- Content: `text-ui-xs` (12px) ✓
- **ABER**: Kategorie-Header: `text-[10px]` ❌ HARD-CODED
- **ABER**: Tabelle: `text-[11px]` ❌ HARD-CODED
- **ABER**: Details: `text-[10px]` ❌ HARD-CODED
- Registry Empty State: `text-xs` ❌ NICHT text-ui-xs!
- RX Pin: `text-xs` ❌ NICHT text-ui-xs!

## BUTTONS & TABS

### Sketch Tabs (sketch.ino)

- Tab Name: `text-ui-sm` (14px) ✓
- Rename Input: `text-ui-sm` (14px) ✓

### OutputPanel Tabs (Compiler, Messages, Registry)

- Parser Analysis Tabs: `text-ui-xs` (12px) ✓

## ZUSAMMENFASSUNG DER INKONSISTENZEN

| Element                | Aktuell       | Sollte sein | Status    |
| ---------------------- | ------------- | ----------- | --------- |
| Serial Monitor         | 12px mono     | 12px mono   | ✓ OK      |
| Compilation Output     | **14px** mono | 12px mono   | ❌ FALSCH |
| Parser Category Header | **10px**      | 12px        | ❌ FALSCH |
| Parser Table           | **11px**      | 12px        | ❌ FALSCH |
| Parser Details         | **10px**      | 12px        | ❌ FALSCH |
| Parser Registry Empty  | text-xs (?)   | text-ui-xs  | ❌ FALSCH |
| Parser RX Pin Label    | text-xs       | text-ui-xs  | ❌ FALSCH |
| Sketch Tabs            | 14px          | 14px        | ✓ OK      |
| Parser Analysis Header | 14px          | 14px        | ✓ OK      |

## ROOT CAUSE

1. `.console-output` CSS-Klasse verwendet `var(--fs-sm)` statt `var(--fs-xs)`
2. Parser Output hat hard-coded `text-[10px]` und `text-[11px]`
3. Noch `text-xs` statt `text-ui-xs` in parser-output.tsx
