# UNOWEBSIM Projekt-Bereinigungsbericht

**Erstellt:** 2026-01-XX  
**Projektversion:** Arduino Uno Web Simulator (UNOWEBSIM)

---

## Zusammenfassung

Eine systematische Analyse des Projekts ergab signifikantes Optimierungspotenzial:

| Kategorie | Anzahl | Geschätzter Code |
|-----------|--------|-----------------|
| **Tote Dateien (Delete)** | 21 | ~3.500 Zeilen |
| **Unused Exports (Modify)** | 1 | ~10 Zeilen |
| **False Positives vermieden** | 10+ | – |

**Hauptursache:** Das Projekt wurde mit dem vollständigen Radix UI Komponentenpaket gestartet, aber nur ein Bruchteil wird tatsächlich verwendet. Die Sidebar-Komponente wurde nie integriert und erzeugt eine Kette unbenutzter Abhängigkeiten.

---

## 1. Streichliste (DELETE)

### 1.1 Leere Dateien (Sofort löschen)

| Datei | Problem |
|-------|---------|
| `src/components/ui/Button.tsx` | **LEER** - 0 Bytes Inhalt |
| `client/src/components/debug-console.tsx` | **LEER** - 0 Bytes Inhalt |

```bash
rm -f src/components/ui/Button.tsx
rm -f client/src/components/debug-console.tsx
```

### 1.2 Redundante Re-Exports

| Datei | Problem |
|-------|---------|
| `client/src/components/features/secret-dialog.tsx` | Einzeiler Re-Export von settings-dialog.tsx, nirgends importiert |

```bash
rm -f client/src/components/features/secret-dialog.tsx
```

### 1.3 Unbenutzte UI-Komponenten (Radix UI Boilerplate)

Diese Dateien werden nirgends im Projekt importiert:

| Datei | Verifikation |
|-------|--------------|
| `client/src/components/ui/carousel.tsx` | Keine Imports gefunden |
| `client/src/components/ui/breadcrumb.tsx` | Keine Imports gefunden |
| `client/src/components/ui/hover-card.tsx` | Keine Imports gefunden |
| `client/src/components/ui/input-otp.tsx` | Keine Imports gefunden |
| `client/src/components/ui/chart.tsx` | Keine Imports gefunden |
| `client/src/components/ui/collapsible.tsx` | Keine Imports gefunden |
| `client/src/components/ui/command.tsx` | Keine Imports gefunden |
| `client/src/components/ui/alert.tsx` | Keine Imports gefunden |
| `client/src/components/ui/toggle.tsx` | Keine Imports gefunden |
| `client/src/components/ui/progress.tsx` | Keine Imports gefunden |
| `client/src/components/ui/textarea.tsx` | Keine Imports gefunden |
| `client/src/components/ui/scroll-area.tsx` | Keine Imports gefunden |
| `client/src/components/ui/select.tsx` | Keine Imports gefunden |

```bash
rm -f client/src/components/ui/carousel.tsx
rm -f client/src/components/ui/breadcrumb.tsx
rm -f client/src/components/ui/hover-card.tsx
rm -f client/src/components/ui/input-otp.tsx
rm -f client/src/components/ui/chart.tsx
rm -f client/src/components/ui/collapsible.tsx
rm -f client/src/components/ui/command.tsx
rm -f client/src/components/ui/alert.tsx
rm -f client/src/components/ui/toggle.tsx
rm -f client/src/components/ui/progress.tsx
rm -f client/src/components/ui/textarea.tsx
rm -f client/src/components/ui/scroll-area.tsx
rm -f client/src/components/ui/select.tsx
```

### 1.4 Unbenutzte Sidebar-Abhängigkeitskette

Die `sidebar.tsx` Komponente wird nirgends verwendet. Sie hat Abhängigkeiten, die ebenfalls nur von ihr importiert werden:

| Datei | Importiert von |
|-------|----------------|
| `client/src/components/ui/sidebar.tsx` | ❌ Nirgends |
| `client/src/components/ui/skeleton.tsx` | Nur sidebar.tsx |
| `client/src/components/ui/sheet.tsx` | Nur sidebar.tsx |
| `client/src/components/ui/separator.tsx` | Nur sidebar.tsx |
| `client/src/hooks/use-mobile.tsx` | Nur sidebar.tsx |

```bash
rm -f client/src/components/ui/sidebar.tsx
rm -f client/src/components/ui/skeleton.tsx
rm -f client/src/components/ui/sheet.tsx
rm -f client/src/components/ui/separator.tsx
rm -f client/src/hooks/use-mobile.tsx
```

---

## 2. Refactoring-Vorschläge (MODIFY)

### 2.1 Unbenutzte Exports entfernen

**Datei:** `client/src/lib/platform.ts`

| Export | Status |
|--------|--------|
| `isMac` | ✅ Verwendet |
| `isWindows` | ❌ Unbenutzt - entfernen |
| `isLinux` | ❌ Unbenutzt - entfernen |

**Empfohlene Änderung:**
```typescript
// Vorher:
export const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
export const isWindows = /Win/.test(navigator.platform);
export const isLinux = /Linux/.test(navigator.platform);

// Nachher:
export const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
```

---

## 3. Bestätigte Komponenten (KEEP)

Diese Komponenten wurden fälschlicherweise als unbenutzt vermutet, sind aber in Verwendung:

| Datei | Verwendet von |
|-------|---------------|
| `client/src/components/ui/toaster.tsx` | App.tsx |
| `client/src/components/ui/alert-dialog.tsx` | sketch-tabs.tsx |
| `client/src/components/ui/tabs.tsx` | arduino-simulator.tsx, parser-output.tsx |
| `client/src/components/ui/tooltip.tsx` | App.tsx (TooltipProvider) |
| `client/src/components/ui/dialog.tsx` | settings-dialog.tsx, sketch-tabs.tsx |
| `client/src/components/ui/dropdown-menu.tsx` | sketch-tabs.tsx, examples-menu.tsx, app-header.tsx |

---

## 4. Analyse-Hinweise

### False Positives vermieden

Die Datei `playwright-report/index.html` enthält minifiziertes JavaScript und CSS, das bei Textsuchen False Positives erzeugt. Diese wurden bei der Analyse herausgefiltert.

### Nicht analysierte Bereiche

Folgende Bereiche wurden aus Zeitgründen nicht tiefgehend analysiert und könnten weiteres Optimierungspotenzial bieten:

1. **WebSocket Message Payloads** - Mögliche ungenutzte Felder in `shared/schema.ts`
2. **Duplicate Code Patterns** - DRY-Verletzungen zwischen ähnlichen Komponenten
3. **Large File Simplification** - `sandbox-runner.ts` könnte vereinfacht werden

---

## 5. Lösch-Skript (Komplett)

```bash
#!/bin/bash
# UNOWEBSIM Cleanup Script
# WARNUNG: Vor Ausführung ein Backup erstellen!

cd /Users/to/sciebo/TT_Web/UNOWEBSIM_github_dupe

# 1. Leere Dateien
rm -f src/components/ui/Button.tsx
rm -f client/src/components/debug-console.tsx

# 2. Redundante Re-Exports
rm -f client/src/components/features/secret-dialog.tsx

# 3. Unbenutzte UI-Komponenten
rm -f client/src/components/ui/carousel.tsx
rm -f client/src/components/ui/breadcrumb.tsx
rm -f client/src/components/ui/hover-card.tsx
rm -f client/src/components/ui/input-otp.tsx
rm -f client/src/components/ui/chart.tsx
rm -f client/src/components/ui/collapsible.tsx
rm -f client/src/components/ui/command.tsx
rm -f client/src/components/ui/alert.tsx
rm -f client/src/components/ui/toggle.tsx
rm -f client/src/components/ui/progress.tsx
rm -f client/src/components/ui/textarea.tsx
rm -f client/src/components/ui/scroll-area.tsx
rm -f client/src/components/ui/select.tsx

# 4. Sidebar-Abhängigkeitskette
rm -f client/src/components/ui/sidebar.tsx
rm -f client/src/components/ui/skeleton.tsx
rm -f client/src/components/ui/sheet.tsx
rm -f client/src/components/ui/separator.tsx
rm -f client/src/hooks/use-mobile.tsx

echo "✅ Cleanup abgeschlossen. 21 Dateien entfernt."
echo "⚠️  Vergessen Sie nicht, platform.ts manuell zu bearbeiten!"
```

---

## 6. Nächste Schritte

1. **Backup erstellen** - `git stash` oder Branch erstellen
2. **Lösch-Skript ausführen** - oder Dateien manuell entfernen
3. **platform.ts bearbeiten** - `isWindows` und `isLinux` entfernen
4. **Tests ausführen** - `npm test` und `npm run build`
5. **Commit** - "chore: remove 21 unused files and dead code"

---

*Bericht generiert durch systematische Code-Analyse mit grep-basierten Import-Checks.*
