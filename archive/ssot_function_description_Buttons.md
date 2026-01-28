# Button-Komponente - Single Source of Truth

Zentrale, konsistente Button-Komponente für die gesamte Anwendung.
Basiert auf `class-variance-authority` (CVA) für flexible Variant-Management.

---

## Ziel
- **Einheitliches Button-Verhalten und -Styling** in der gesamten App
- **Keine nativen `<button>` HTML-Elemente** mehr im Code
- **Vorhersehbare, testbare Styling-Logik** durch CVA
- **Barrierefreie** Implementierung mit ARIA-Attributen
- **Konsistente Dimensionen** via CSS-Variablen

---

## Architektur
- **Single File**: `client/src/components/ui/button.tsx`
- **Framework**: React 18+ mit TypeScript
- **Styling**: Tailwind CSS + class-variance-authority (CVA)
- **CSS-Variablen**: `--ui-button-height` (2rem/32px), Theme-Farben
- **Margin**: Konsistent `m-1` (0.25rem) auf allen Buttons

---

## API

```tsx
<Button 
  variant="default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size="default" | "sm" | "lg" | "icon"
  disabled?: boolean
  asChild?: boolean  // Radix-UI Slot
  onClick?: (event) => void
  className?: string  // Zusätzliche Tailwind-Klassen
  aria-label?: string  // Für Icon-Buttons
  children: React.ReactNode
/>
```

---

## Varianten (CVA-definiert)
| Variante | Zweck | Styling |
|----------|-------|---------|
| `default` | Primäraktion | Blau, Hover: dunkler blau |
| `destructive` | Destruktive Aktion | Rot, Hover: dunkler rot |
| `outline` | Sekundäraktion | Border, transparent BG |
| `secondary` | Alternative Aktion | Grau, Hover: dunkler grau |
| `ghost` | Subtil / Navigation | Transparent, Hover: leicht grau |
| `link` | Text-Link-Stil | Underline, Link-Farbe |

## Größen (CVA-definiert)
| Größe | Padding | Einsatz |
|-------|---------|---------|
| `default` | `h-10 px-4 py-2` | Standard Button |
| `sm` | `h-9 px-3` | Kompakt |
| `lg` | `h-11 px-8` | Prominent |
| `icon` | `h-10 w-10` | Icon-only Buttons |

 ---

 ## Zustände
- **Normal** → Standard Button
- **Hover** → Farbänderung (Variant-abhängig)
- **Focus** → Ring um Button (Focus-visible)
- **Active** → Gedrückt-Zustand
- **Disabled** → Kein Klick, reduzierte Opazität

---

## Accessibility
- ✅ Native `<button>`-Semantik
- ✅ Vollständige Tastaturbedienung (Tab, Enter, Space)
- ✅ ARIA-Attribute für Icon-Buttons (`aria-label`)
- ✅ Focus-Indikator sichtbar (ring-2)
- ✅ Ausreichender Farbkontrast (WCAG AA+)
- ✅ forwardRef für direkte Zugriffe auf DOM-Element

---

## Best Practices
- ✅ **Immer** die `Button`-Komponente verwenden
- ✅ `variant="ghost"` für Menü-Items und Navigation
- ✅ `size="icon"` für Icon-only Buttons mit `aria-label`
- ✅ `variant="outline"` für Abbrechen/Cancel-Aktionen
- ✅ `variant="default"` für primäre Aktionen
- ✅ **KEINE** nativen `<button>` HTML-Elemente mehr
- ✅ **KEINE** Inline-Styles für Button-spezifische Styling

---

## Implementierte Button-Instanzen

### arduino-simulator.tsx
- 5 Menü-Buttons: File, Edit, Sketch, Tools, Help (`variant="ghost"`)
- 4 Mobile Panel Toggle-Buttons (`variant="ghost" size="icon"`)

### arduino-board.tsx
- Dialog-Buttons: Abbrechen (`outline`), Bestätigung (`default`)

### settings-dialog.tsx
- Farb-Preset-Buttons (`variant="outline" size="icon"`)

### sidebar.tsx
- SidebarRail Toggle-Button (`variant="ghost" size="icon"`)

### Weitere Standard-Buttons
- Carousel Navigation (carousel.tsx)
- Parser Output Aktionen (parser-output.tsx)
- Input Groups (input-group.tsx)
- Compilation Output Controls (compilation-output.tsx)
- Examples Menu (examples-menu.tsx)
- Sketch Tabs (sketch-tabs.tsx)

---

## Quelldatei
```
client/src/components/ui/button.tsx
```

**Länge**: 59 Zeilen  
**Abhängigkeiten**: 
- `@radix-ui/react-slot` (Slot-Komponente)
- `class-variance-authority` (CVA)
- `@/lib/utils` (cn-Utility)

---

## Beispiele

### Standard Button
```tsx
<Button variant="default" onClick={handleSave}>
  Speichern
</Button>
```

### Icon Button mit Label
```tsx
<Button 
  variant="ghost" 
  size="icon"
  aria-label="Close"
>
  <X className="w-4 h-4" />
</Button>
```

### Ghost Button für Menü
```tsx
<Button 
  variant="ghost" 
  className="menu-item"
  tabIndex={0}
>
  File
</Button>
```

### Dynamische Farbe (z.B. Mobile Panel)
```tsx
<Button
  variant="ghost"
  size="icon"
  className={clsx(
    "w-[var(--ui-button-height)] h-[var(--ui-button-height)] rounded-full",
    isActive ? "bg-blue-600 text-white" : "bg-transparent"
  )}
>
  <Icon className="w-5 h-5" />
</Button>
```

---

## Tests
- ✅ Build erfolgreich ohne TypeScript-Fehler
- ✅ Alle 14 nativen `<button>` Elemente konvertiert
- ✅ Kein mehr nativen HTML-Buttons im Codebase
- ✅ Konsistente Dimensionen via `--ui-button-height`
- ✅ Alle Variant-Kombinationen funktional

---

## Status
- ✅ **PRODUCTION-READY**
- Komplette Konvertierung aller nativen Buttons abgeschlossen
- Zentrale Source-of-Truth etabliert
- Build validiert

**Version**: 2.0 (Final)  
**Datum**: 23. Januar 2026  
**Konvertiert von**: 14 nativen `<button>` Elementen zu einheitlicher Button-Komponente

---

## Tests - Details (Archiv)

 ---

 ### Unit Tests
 - Button rendert korrekt
 - Text wird angezeigt
 - `onClick` wird ausgelöst
 - Kein Klick bei `disabled`
 - Kein Klick bei `loading`
 - `aria-busy` bei Loading gesetzt

 ---

 ### Accessibility Tests
 - Fokus per Tab möglich
 - Aktivierung per Enter / Space
 - Disabled Buttons nicht aktivierbar

 ---

 ### Beispiel-Test

 ```ts
 render(<Button loading>Speichern</Button>);
 expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
 ```

 ---

 ## Status
 - Minimal
 - Verständlich
 - Testbar

 Version: 1.0
