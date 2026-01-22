# Font Size Measurement Script

Automatisches Messskript zur Validierung der globalen Schriftgrößen-Konsistenz in der Arduino-Simulator-Anwendung.

## Voraussetzungen

### 1. Python 3
```bash
python3 --version  # Sollte Python 3.8+ sein
```

### 2. Google Chrome
```bash
brew install --cask google-chrome  # macOS
```

### 3. ChromeDriver
```bash
brew install chromedriver  # macOS
```

### 4. Selenium
```bash
pip3 install selenium
```

## Konfiguration

### Selektoren anpassen
Bearbeite `font_selectors.json`, um die zu messenden Komponenten zu definieren:

```json
[
  {
    "name": "Komponenten-Name",
    "description": "Kurzbeschreibung",
    "selector": ".css-selektor"
  }
]
```

## Verwendung

### 1. Anwendung starten
```bash
npm run dev:full
```
Die Anwendung läuft dann auf `http://localhost:5173`

### 2. Messskript ausführen
```bash
python3 measure_font_sizes.py --url http://localhost:5173
```

### Optionen
```bash
# Mit sichtbarem Browser (zum Debuggen)
python3 measure_font_sizes.py --no-headless

# Andere URL
python3 measure_font_sizes.py --url http://localhost:3000

# Custom Output-Dateien
python3 measure_font_sizes.py --output my_report.md --csv my_report.csv

# Andere Konfigurationsdatei
python3 measure_font_sizes.py --config custom_selectors.json
```

## Ausgabe

Das Skript erzeugt zwei Dateien:

### 1. `font_report.md` (Markdown-Tabelle)
Vollständiger Report mit:
- Messwerten für alle 5 Skalierungen (S/M/L/XL/XXL)
- Status für jede Komponente (✓/✗)
- Abweichungen in Pixeln
- Zusammenfassung mit Erfolgsquote

### 2. `font_report.csv` (CSV für Excel)
Gleiche Daten im CSV-Format für weitere Analyse.

## Interpretation

### Status-Spalte
- **✓** = Schriftgröße korrekt skaliert (max. 1px Abweichung)
- **✗** = Schriftgröße weicht ab (>1px Abweichung)
- **Nicht gefunden** = Element konnte nicht gefunden werden
- **Timeout** = Element wurde nicht rechtzeitig geladen

### Abweichung
- **0.0** = Perfekt
- **+2.0** = 2px zu groß
- **-1.5** = 1.5px zu klein

## Troubleshooting

### ChromeDriver-Fehler
```bash
# ChromeDriver neu installieren
brew reinstall chromedriver

# Bei macOS-Sicherheitswarnung:
xattr -d com.apple.quarantine $(which chromedriver)
```

### Selenium nicht gefunden
```bash
pip3 install --upgrade selenium
```

### Port bereits belegt
Stelle sicher, dass die App auf dem richtigen Port läuft:
```bash
lsof -i :5173
```

### Element nicht gefunden
- Prüfe die Selektoren in `font_selectors.json`
- Verwende `--no-headless` um den Browser sichtbar zu machen
- Erhöhe ggf. die Wartezeiten im Code

## Erwartete Schriftgrößen

| Skalierung | Pixel | Scale-Faktor |
|------------|-------|--------------|
| S          | 12px  | 0.875        |
| M          | 14px  | 1.0          |
| L          | 16px  | 1.125        |
| XL         | 18px  | 1.25         |
| XXL        | 20px  | 1.5          |

## Beispiel-Output

```
Testing scale M (14px)...
  Measuring: Code-Editor...
    → 14.0px (expected 14px, diff: 0.0px) ✓
  Measuring: Compiler-Output...
    → 14.0px (expected 14px, diff: 0.0px) ✓
  Measuring: Serieller Monitor...
    → 12.0px (expected 14px, diff: -2.0px) ✗

✅ Fertig! Ergebnisse in:
   - font_report.md
   - font_report.csv
```

## Integration in CI/CD

Das Skript kann auch in CI/CD-Pipelines integriert werden:

```bash
# Exit Code 0 = alle Tests bestanden
# Exit Code 1 = Fehler oder Tests fehlgeschlagen
python3 measure_font_sizes.py && echo "✓ Font sizes OK" || echo "✗ Font size issues found"
```
