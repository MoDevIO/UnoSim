# 🚀 SCHNELLSTART: Monaco-Editor-Fehler beheben

## Schritt 1: Browser aktualisieren
```
Ctrl+Shift+R  (Windows/Linux)
oder
Cmd+Shift+R   (Mac)
```
**Wichtig:** Hard-Refresh, nicht nur F5!

## Schritt 2: Browser-Konsole öffnen
```
F12  →  "Konsole" Tab
```

## Schritt 3: Erwartete Ausgabe sehen
Sie sollten folgende Meldungen sehen:
```
[CodeEditor] Component mounted, loading Monaco...
[CodeEditor] Monaco loaded successfully
[CodeEditor] Starting editor initialization with container: [object HTMLDivElement]
[CodeEditor] Editor created successfully: [object Object]
[CodeEditor] DOM container innerHTML length: 12847
[CodeEditor] Initialization complete! {containerSize: {…}, computedStyle: {…}}
```

## Schritt 4: Editor testen
- ✅ Code sollte sichtbar sein
- ✅ Zeilennummern sollten sichtbar sein
- ✅ Sie können tippen und Code eingeben
- ✅ Syntax-Highlighting sollte funktionieren
- ✅ Beispiele laden sollte funktionieren
- ✅ Compile & Run sollte funktionieren

---

## Falls es immer noch nicht funktioniert:

### Debug-Befehl in der Konsole ausführen:
```javascript
// Kopieren Sie dies in die Konsole und drücken Sie Enter:
const container = document.querySelector('[data-testid="code-editor"]');
console.log('Container Größe:', {
  height: container.offsetHeight,
  width: container.offsetWidth,
  display: getComputedStyle(container).display,
  visibility: getComputedStyle(container).visibility
});
```

### Erwartete Ausgabe:
```javascript
Container Größe: {
  height: 450,           // ← Sollte > 0 sein
  width: 800,            // ← Sollte > 0 sein
  display: "flex",       // ← Sollte "flex" sein
  visibility: "visible"  // ← Sollte "visible" sein
}
```

### Was bedeutet es wenn Werte falsch sind:

| Problem | Bedeutung | Lösung |
|---------|-----------|--------|
| `height: 0` | Container hat keine Höhe | Parent-Container prüfen |
| `display: "none"` | Container ist versteckt | CSS überprüfen |
| `visibility: "hidden"` | Container ist versteckt | CSS überprüfen |

---

## Wenn Container-Größe = 0 ist:

```javascript
// Parent-Container-Kette prüfen:
let p = document.querySelector('[data-testid="code-editor"]').parentElement;
let level = 0;
while(p && level < 6) {
  const styles = getComputedStyle(p);
  console.log(`Level ${level} (${p.className}):`, {
    height: styles.height,
    display: styles.display,
    overflow: styles.overflow
  });
  p = p.parentElement;
  level++;
}
```

Suchen Sie nach einem Parent mit:
- `display: "none"` 
- `height: "0"`
- `visibility: "hidden"`

---

## Manuelle Layout-Triggering (Notfall)

Falls der Editor immer noch nicht rendert:

```javascript
// Alle Editoren finden und Layout auslösen
const editors = window.monaco?.editor?.getEditors?.() || [];
console.log('Gefundene Editoren:', editors.length);
editors.forEach((e, i) => {
  console.log(`Editor ${i}: Triggering layout...`);
  e.layout?.();
  console.log(`Editor ${i}: Layout complete`);
});
```

---

## Weitere Ressourcen

- **Detaillierte Dokumentation:** `MONACO_REPAIR_SUMMARY.md`
- **Erweiterte Diagnostik:** `MONACO_FIX.md`
- **Debug-Skript:** `DEBUG_MONACO.js`

---

## Zusammengefasste Änderungen

✅ Explizites `editor.layout()` nach Editor-Erstellung  
✅ ResizeObserver für Größenänderungen  
✅ CSS-Verbesserungen am Container  
✅ Umfassendes Debugging in der Konsole  

Siehe `MONACO_REPAIR_SUMMARY.md` für technische Details!
