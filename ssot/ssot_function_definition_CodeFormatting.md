# Funktionsbeschreibung: „Format Code“ im Editor

Status: current  
Zielrolle: feature-contract  
Ziel-SSOT für den Befehl „Format Code“ (Menü **File → Format Code**, ⋯-Menü der Sketch-Tabs, `Ctrl+Shift+F` / `⇧⌘F`).

## 1. Ziel

Lernende sehen an der Einrückung die tatsächliche Struktur ihres Programms: welche Anweisung zu welchem
`if`, `else`, `for`, `while` oder `do` gehört. „Format Code“ stellt diese Einrückung her, ohne die Bedeutung des
Sketches zu ändern.

## 2. Abgrenzung

- **„Format Code“** formatiert den ganzen Sketch auf Befehl (dieses Dokument).
- **Einrückung beim Tippen** (Enter, `autoIndent`, `client/src/lib/editor/arduino-language-configuration.ts`)
  ist eine andere Funktion. Sie richtet nur die nächste Zeile aus und folgt den Einrückungsregeln von Monaco;
  ihre Grenzen stehen in `docs/OPEN_POINTS.md` (`EDITOR-INDENT`).

## 3. Verhalten

### 3.1 Einrückung

- Zwei Leerzeichen je Ebene; Tabs in der Einrückung werden ersetzt.
- Der Inhalt eines Blocks `{ … }` steht eine Ebene tiefer als die Zeile, die den Block öffnet; `}` steht auf der
  Ebene dieser Zeile.
- **Klammerlose Kontrollanweisungen:** Die eine Anweisung nach `if (…)`, `else`, `for (…)`, `while (…)` und `do`
  ohne `{` steht eine Ebene tiefer. Die Anweisung danach steht wieder auf der Ebene der Kontrollanweisung.
  Verschachtelte klammerlose Anweisungen rücken je Ebene weiter ein.
- **`else`** steht auf der Ebene des `if`, zu dem es nach C++ gehört (das nächste vorangehende `if` ohne `else`).
  `else if` bildet eine Kette auf derselben Ebene.
- **`do … while (…);`**: Das abschließende `while` steht auf der Ebene des `do`.
- **`switch`:** `case`- und `default`-Marken eine Ebene unter `switch`, die Anweisungen danach eine Ebene tiefer.
- **Fortsetzungszeilen:** Eine Zeile, die eine unvollständige Anweisung fortsetzt (zum Beispiel eine mehrzeilige
  Bedingung), steht zwei Ebenen tiefer als der Anfang der Anweisung. Die Zeilen einer Initialisierungsliste
  `= { … }` stehen eine Ebene tiefer als ihre öffnende Zeile.
- **Kommentarzeilen** und **Präprozessorzeilen** stehen auf der Ebene der folgenden Codezeile; ein Kommentar
  zwischen Bedingung und Anweisung steht also auf der Ebene der Anweisung. Vor einer schließenden `}` stehen sie
  auf der Ebene des Blockinhalts.

### 3.2 Zeilen

- Die geschweifte Klammer eines Blocks bekommt eine eigene Zeilengrenze: Nach `{` beginnt eine neue Zeile, vor `}`
  ebenso, und nach `}` beginnt die nächste Anweisung in einer neuen Zeile. Auf derselben Zeile bleiben ein
  Kommentar sowie `else`, das `while` eines `do`, `;` und `,`.
- Klammern einer Initialisierungsliste (`int a[] = {1, 2};`) bleiben, wo sie sind.
- Eine klammerlose Anweisung in derselben Zeile wie ihre Bedingung (`if (x) y();`) bleibt in dieser Zeile.
- „Format Code“ fügt **keine** Klammern und keine Semikolons hinzu und ändert Leerzeichen innerhalb einer Zeile
  nicht.
- Zeilenenden werden zu `\n`; Leerzeichen am Zeilenende entfallen; höchstens eine Leerzeile in Folge; die Datei
  endet mit genau einem Zeilenumbruch.

### 3.3 Geschützte Bereiche

Zeichenketten (auch mit Präfix und Fortsetzung über `\`), Zeichenliterale, Raw-Strings `R"x(…)x"`, Kommentare
und Präprozessorzeilen (auch mit Fortsetzung über `\`) sind Text, keine Programmstruktur: Klammern, Semikolons
und Schlüsselwörter darin zählen nicht, und ihr Inhalt bleibt unverändert. Ausnahmen: Die Folgezeilen eines
mehrzeiligen Blockkommentars verschieben sich um denselben Betrag wie seine erste Zeile; Leerzeichen am Ende
einer Kommentar- oder Präprozessorzeile entfallen. Leerzeilen innerhalb eines Raw-Strings oder Kommentars bleiben.

### 3.4 Eigenschaften

- **Bedeutungserhaltend:** Nach dem Entfernen aller Leerzeichen und Zeilenumbrüche außerhalb geschützter Bereiche
  ist der Sketch vor und nach dem Formatieren gleich.
- **Idempotent:** Zweimal formatieren ergibt dasselbe wie einmal.
- **Robust:** Unvollständiger Code (fehlende Klammer, offener String) wird formatiert, ohne Text zu verlieren;
  die Laufzeit wächst linear mit der Länge.
- **Eine Implementierung:** Editor und Rückfall ohne Editor verwenden `client/src/lib/editor/format-code.ts`.
- **Rückgängig:** Ein Formatieren ist ein Schritt im Verlauf des Editors; Rückgängig stellt den Text davor wieder her.

## 4. Akzeptanz

- Unit (`tests/client/editor-format-code.test.ts`): das Beispiel `if`/`else` ohne Klammern in `loop()`,
  Verschachtelung, `else`-Zuordnung, `else if`, `for`, `while`, `do … while`, mehrzeilige Bedingung, Kommentar
  zwischen Bedingung und Anweisung, `switch`, Initialisierungslisten, geschützte Bereiche, Bedeutungserhalt und
  Idempotenz über alle Fälle und die eingebauten Beispiele.
- Browser (`e2e/editor-format-code.spec.ts`): „Format Code“ über das echte Menü im Monaco-Editor ergibt den
  erwarteten Text; Rückgängig stellt den Text davor wieder her.

## 5. Grenzen

- Kein vollständiger C++-Parser: Die Einrückung folgt Token und Anweisungsgrenzen. Makros, die Kontrollstrukturen
  oder Klammern verbergen, und Präprozessor-Zweige mit unvollständigen Blöcken werden nach ihrem sichtbaren Text
  eingerückt.
- Präprozessorzeilen werden wie Anweisungen eingerückt, nicht in Spalte 0 gesetzt.
- Kein Umbruch langer Zeilen und keine Leerzeichen-Normalisierung innerhalb einer Zeile.
