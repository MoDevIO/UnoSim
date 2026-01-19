# 🔧 Monaco Editor Fix - Diagnose und Lösung

**Problem:** Monaco Editor zeigt nichts an, keine Zeilennummern, aber Code kann geladen und ausgeführt werden.

## 🚀 Sofortmaßnahmen

### 1. **Browser-Konsole öffnen** (F12)
```javascript
// Folgendes in die Konsole kopieren und ausführen:
const editors = window.monaco?.editor?.getEditors?.() || [];
editors.forEach(e => e.layout?.());
console.log('Editor layout triggered:', editors.length);
```

### 2. **Debug-Information sammeln**
```javascript
// Diese Datei in der Konsole ausführen:
// Copy-paste den Inhalt von DEBUG_MONACO.js
```

## 🔍 Was wurde repariert

### Code-Editor Änderungen ([client/src/components/features/code-editor.tsx](client/src/components/features/code-editor.tsx)):

1. ✅ **Explizites `editor.layout()` nach Erstellung**
   - Monaco Editor muss explizit sagen, dass es sich selbst layouten soll

2. ✅ **ResizeObserver hinzugefügt**
   - Beobachtet Container-Größenänderungen
   - Ruft automatisch `layout()` auf

3. ✅ **CSS-Verbesserungen**
   ```css
   display: flex;
   flex-direction: column;
   overflow: hidden;
   ```
   - Stellt sicher, dass der Container richtig dimensioniert wird

4. ✅ **Umfassendes Debugging**
   - Console-Ausgaben zeigen:
     - Container-Größe
     - Computed CSS-Stile
     - Editor-Render-Status
     - ResizeObserver-Trigger

## 📋 Debugging-Ausgaben in der Browser-Konsole

Wenn Sie die App neu laden (mit F5), sollten Sie folgende Logs sehen:

```
[CodeEditor] Component mounted, loading Monaco...
[CodeEditor] Monaco loaded successfully
[CodeEditor] Starting editor initialization...
[CodeEditor] Editor created successfully
[CodeEditor] DOM container innerHTML length: [>0]
[CodeEditor] Initialization complete! {...}
```

## 🎯 Nächste Schritte

### Wenn der Editor immer noch nicht sichtbar ist:

1. **Öffnen Sie F12 (DevTools)**
2. **Führen Sie aus:**
   ```javascript
   const container = document.querySelector('[data-testid="code-editor"]');
   console.log({
     height: container.offsetHeight,
     width: container.offsetWidth,
     display: getComputedStyle(container).display,
     visibility: getComputedStyle(container).visibility
   });
   ```

3. **Prüfen Sie:**
   - ✓ `height > 0` und `width > 0`?
   - ✓ `display` = `"flex"`?
   - ✓ `visibility` = `"visible"`?

### Falls Größe = 0:

Das ist ein Parent-Container-Problem. Prüfen Sie den Layout:
```javascript
let p = document.querySelector('[data-testid="code-editor"]').parentElement;
while(p) {
  console.log(p.className, getComputedStyle(p).height, getComputedStyle(p).display);
  p = p.parentElement;
}
```

## 🔄 Weitere Versuche

1. **Hard-Refresh:** `Ctrl+Shift+R` (oder `Cmd+Shift+R` auf Mac)
2. **Browser-Cache:** Devtools → Network → Disable cache
3. **Unterschiedliche Browser:** Firefox/Chrome unterscheiden sich manchmal

## 📞 Wenn nichts funktioniert

Führen Sie DEBUG_MONACO.js aus und teilen Sie die Ausgabe:
- Container-Größe?
- Gefundene Editoren?
- CSS `display`/`visibility`?
- Parent-Container-Layout?
