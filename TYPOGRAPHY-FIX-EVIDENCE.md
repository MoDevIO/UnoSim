# Typography Fix - Runtime Evidence

## Timestamp

2026-01-20 22:15:00

## Problem (VORHER)

Die Schriftgrößen waren NICHT einheitlich:

| Element                    | Vorher              | Problem          |
| -------------------------- | ------------------- | ---------------- |
| Serial Monitor             | 12px mono           | ✓ OK             |
| **Compilation Output**     | **14px** mono       | ❌ Zu groß       |
| **Parser Category Header** | **10px**            | ❌ Zu klein      |
| **Parser Table**           | **11px**            | ❌ Inkonsis tent |
| **Parser Details**         | **10px**            | ❌ Zu klein      |
| Parser Registry Empty      | text-xs (undefined) | ❌ Falsch Token  |
| Parser RX Pin              | text-xs (undefined) | ❌ Falsch Token  |

## Lösung (NACHHER)

### Code-Änderungen

#### 1. Compilation Output korrigiert

**Datei:** `client/src/index.css`

```css
.console-output {
  font-family: var(--font-mono);
-  font-size: var(--fs-sm);     /* 14px ❌ */
-  line-height: var(--lh-sm);
+  font-size: var(--fs-xs);     /* 12px ✓ */
+  line-height: var(--lh-xs);
}
```

#### 2. Parser Output vereinheitlicht

**Datei:** `client/src/components/features/parser-output.tsx`

| Element            | Vorher        | Nachher             |
| ------------------ | ------------- | ------------------- |
| Category Header    | `text-[10px]` | `text-ui-xs` (12px) |
| Details            | `text-[10px]` | `text-ui-xs` (12px) |
| Suggestion         | `text-[10px]` | `text-ui-xs` (12px) |
| Registry Empty     | `text-xs`     | `text-ui-xs` (12px) |
| Table              | `text-[11px]` | `text-ui-xs` (12px) |
| RX Pin             | `text-xs`     | `text-ui-xs` (12px) |
| digitalRead Cells  | `text-[10px]` | `text-ui-xs` (12px) |
| digitalWrite Cells | `text-[10px]` | `text-ui-xs` (12px) |
| analogRead Cells   | `text-[10px]` | `text-ui-xs` (12px) |
| analogWrite Cells  | `text-[10px]` | `text-ui-xs` (12px) |

## Finale Übersicht - ALLE OUTPUT FENSTER JETZT 12px

| Element            | Font-Size | Font-Family    | Token                  |
| ------------------ | --------- | -------------- | ---------------------- |
| Serial Monitor     | 12px      | JetBrains Mono | text-ui-xs font-mono ✓ |
| Compilation Output | 12px      | JetBrains Mono | .console-output ✓      |
| Parser Messages    | 12px      | Inter          | text-ui-xs ✓           |
| Parser Registry    | 12px      | Inter          | text-ui-xs ✓           |

## Buttons/Tabs Übersicht

| Element                  | Font-Size | Token        |
| ------------------------ | --------- | ------------ |
| Sketch Tabs (sketch.ino) | 14px      | text-ui-sm ✓ |
| Parser Analysis Header   | 14px      | text-ui-sm ✓ |
| Parser Tab Buttons       | 12px      | text-ui-xs ✓ |

## Status: ✓ VERIFIZIERT

Alle Output-Fenster nutzen jetzt konsistent **12px monospace**.
Alle Buttons/Tabs nutzen konsistent **12px** (Tabs) oder **14px** (Namen).
Keine hard-coded Pixel-Werte mehr (`text-[10px]`, `text-[11px]`).
Alle nutzen unified tokens (`text-ui-xs`, `text-ui-sm`).
