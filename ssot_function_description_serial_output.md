# Funktionsbeschreibung: Serieller Output-Stream (Arduino Sandbox)

## 1. Übersicht
Das System emuliert die serielle Schnittstelle eines Arduino-Sketches. Es fängt die Standardausgabe des kompilierten C++ Programms ab, formatiert sie gemäß den Arduino-Regeln und streamt sie in Echtzeit an das Frontend.

## 2. Datentyp-Konvertierung (Print-Klasse)
Der Simulator bildet das Verhalten der Arduino-`Print`-Bibliothek ab. Die Konvertierung erfolgt serverseitig:

| Datentyp | Transformation | Beispiel |
| :--- | :--- | :--- |
| **Integer** | Dezimal-String (Standard). | `101` -> `"101"` |
| **Integer + Base** | Umwandlung in BIN, OCT, HEX. | `(78, HEX)` -> `"4E"` |
| **Float** | Standardmäßig 2 Nachkommastellen (gerundet). | `3.1415` -> `"3.14"` |
| **Float + Prec** | Spezifizierte Nachkommastellen. | `(1.234, 3)` -> `"1.234"` |
| **Boolean** | Konvertierung in "1" oder "0". | `true` -> `"1"` |

## 3. Streaming- & Buffer-Strategie
Um eine flüssige Darstellung im Frontend zu gewährleisten, wird eine **zeitbasierte Chunk-Logik** implementiert:

* **Buffer-Mechanismus:** Empfangene Bytes werden in einem flüchtigen Speicher gesammelt.
* **Immediate Flush:** Daten werden sofort gesendet, wenn ein Newline (`\n`) oder ein Wagenrücklauf (`\r`) erkannt wird.
* **Timed Flush:** Wenn kein Newline empfangen wird, wird der Buffer nach spätestens **20ms** automatisch geleert und gesendet (ermöglicht die Darstellung der "Drei Punkte" `...`).
* **Setup/Loop-Persistenz:** Der Stream-Kontext bleibt beim Übergang von `setup()` zu `loop()` vollständig erhalten.

## 4. Steuerzeichen & Interpretation
Das Backend fungiert als transparenter Proxy für Steuerzeichen. Die Interpretation erfolgt im Frontend (z. B. durch xterm.js).
- **CR/LF:** Standard Zeilensteuerung.
- **Backspace (`\b`):** Wird als RAW-Byte weitergegeben, damit das Frontend den Cursor bewegen kann.
- **ANSI Escape Sequences:** Werden für farbige Ausgaben oder Positionierung unterstützt.

## 5. Baudraten-Simulation
- **Logik:** Die Baudrate wird primär als **visueller Effekt im Frontend** simuliert (Zeichen-Verzögerung).
- **Backend:** Das Backend liefert Daten "Best-Effort" so schnell wie möglich, um System-Ressourcen zu schonen und Komplexität im Sandbox-Prozess zu vermeiden.