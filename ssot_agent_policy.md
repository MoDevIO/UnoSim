# Agent Runtime-Evidence Policy

## 1. Grundprinzipien

1. **Getrennte Ebenen prüfen**
   - **Code-Ebene:** Existiert State / Hook / Berechnung
   - **Runtime/UI-Ebene:** Effekt ist sichtbar, DOM korrekt aktualisiert
   - **Tests:** Automatisierte Tests messen **wirkliche UI-Änderungen**, nicht nur Codeausführung

2. **Keine Selbstbehauptungen**
   - Aussagen wie "ist implementiert", "Tests sind grün" oder "sollte funktionieren" sind **ungültig**
   - Alles muss mit **beobachtbarem Zustand** untermauert sein

3. **Verpflichtende Beweise**
   - Vorher-Nachher-State
   - DOM-Attribute oder Style-Werte
   - Test-Assertions, die UI-Verhalten zeigen
   - Screenshots oder Snapshot-Tests, falls nötig

4. **Priorisierung von Benutzerabsicht**
   - Wenn Auto-Logik und User-Eingabe kollidieren, entscheidet **immer der User**
   - Auto-Logik schlägt nur vor oder öffnet, überschreibt aber nicht manuelle Schließungen

## 2. Vorgehensweise für den Agenten

Für **jedes Feature**:

1. **Initialzustand ermitteln**
   - State
   - DOM
   - Props

2. **Trigger auslösen**
   - z. B. Compile-Fehler, Parser-Messages, Erfolgs-Compile

3. **Finalzustand prüfen**
   - State nach Trigger
   - DOM nach Render

4. **Evidenz liefern**
   - exakte numerische Werte (z. B. `style.height` in px/%)
   - Tab-Status
   - Sichtbarkeit (`display`, `className`, etc.)
   - Assertion oder Screenshot

5. **Fehlerhafte Features markieren**
   - Wenn State gesetzt ist, aber DOM nicht reagiert → Feature = defekt
   - Wenn Auto-Logik Toggle übersteuert → Feature = defekt
   - Keine "grüne Tests" Behauptungen akzeptieren

## 3. Checkliste für jeden Agenten-Durchlauf

- [ ] Feature-State existiert?
- [ ] Trigger löst State-Änderung aus?
- [ ] State wird korrekt an DOM gebunden?
- [ ] Sichtbarkeit/Größe korrekt?
- [ ] Benutzersteuerung respektiert?
- [ ] Alle Evidenzen dokumentiert (numerisch / DOM / Assertions)?
- [ ] Fehler explizit markiert, wenn nicht erfüllt?

> Nur wenn alle Punkte erfüllt → Feature = **verifiziert**

## 4. Beispielhafte Agenten-Prompt-Vorlage

```
Du darfst KEINE Behauptungen ohne Runtime-Beweis machen.
Für jedes Feature MUSST du liefern:
1) Initial-State
2) Trigger-Aktion
3) Final-State
4) DOM- oder Style-Evidence
5) Aussage: funktioniert JA/NEIN
Wenn irgendetwas fehlschlägt → Feature als DEFEKT markieren
```

## 5. Tipps zur Implementation

1. **State → DOM Binding sauber gestalten**
   - `compilationPanelSize` direkt an `style.height` oder `size` weitergeben
   - State-Updates müssen rerendern

2. **useEffect-Dependencies sauber**
   - Keine zirkulären Updates
   - Alle Trigger im Dependency-Array auflisten

3. **User-Priorität**
   - `userWantsPanelOpen` > `autoWantsPanelOpen`
   - Auto-Öffnen nur, wenn nicht manuell geschlossen

4. **Tests**
   - Unit-Tests prüfen Berechnung
   - Integration-Tests prüfen UI-Effekt
   - Edge-Cases (lange Fehler, leere Messages, schnelle Statuswechsel)
