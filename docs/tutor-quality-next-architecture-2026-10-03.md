# Tutor Quality – Neubewertung nach der Promptserie und nächster Architekturschritt

Status: Analyse und Vorschlag, **nicht normativ**. Schließt die Promptserie
v1 / v3 / v4 ab (`docs/tutor-quality-answer-frame-rerun-2026-10-03.md`,
`docs/tutor-quality-guidance-only-rerun-2026-10-03.md`) und bewertet die
verbleibenden Probleme neu. Alle Aussagen über den echten Course Content
beziehen sich auf `MoDevIO/UnoSim-Examples` @ `2ac716f` (= `origin/main`) und
wurden deterministisch mit dem echten `TutorService`, `CurriculumTutorAdapter`,
Matcher und Planner und einem Fake-Provider nachgestellt. Keine Provider-Calls.

## 1. Kernbefund: Der gemessene Corpus und der Produktbetrieb fallen auseinander

Die Anchor-Fixtures nutzen Topic-Schema v2 mit `extensions` und `deepening`.
Der echte Course Content nutzt **keines davon**:

| Merkmal | Anchor-Fixtures | UnoSim-Examples |
| --- | --- | --- |
| Topic-Schema | v2 (DEEPEN/EXPAND-Fixtures) | v1 (`long-values`, `variables-and-serial`) |
| `extensions` | 1–2 | 0 |
| `deepening` | konfiguriert | Default |
| Fragen pro Topic | 3 | 4 (je 1 Transfer) |
| Tutor-Manifest | v2 | v1, keine Phasenstrategien |

Folgen im echten Betrieb (starke lernende Person, Rating 4 oder 5):

| Beispiel | Verlauf |
| --- | --- |
| `it01-01-variable-speichern` | LEARN 3 Fragen → DEEPEN 1 Frage → danach **für den Rest der Sitzung `content-exhausted`** (auch in EXPAND) |
| `it03-05-millis` | `long-values` nach 2 Fragen gemeistert → `variables-and-serial` wird aktiv und ist unlösbar → **LEARN blockiert für den Rest der Sitzung** |
| `it06-03-for` | `variables-and-serial` von Anfang an unlösbar → **keine einzige geplante Frage** |

Über den ganzen Katalog: In **16 von 35 Beispielen** aktiviert
`variables-and-serial` (Aktivierung `serial-call: print`), ist aber vom ersten
Turn an unlösbar. Ursache: Das Konzept `serial-output` hat die Voraussetzung
`variable-values`, deren Fragen `type-used: int` verlangen. Ohne `int` ist
`variable-values` nicht abfragbar, `serial-output` damit nie auswählbar, und
das Topic bleibt „unresolved“. Das Runtime-Verhalten ist SSOT-konform
(LearningQuestions 2.3: ein unresolved Topic blockiert in LEARN); der Fehler
liegt im Content.

Warum das Authoring-Gate ihn nicht findet: `tutor-quality-validator.ts` prüft
Voraussetzungen, Mastery-Kapazität und den ausführbaren Pfad nur für Topics,
die ein Quality-Case **erwartet**. `variables-and-serial` ist im Case
`long-values-positive` nur mitaktiviert und wird nie geprüft; die übrigen
betroffenen Beispiele sind keine Quality-Cases.

Bewertung: Das ist das schwerste aktuell belegte Tutor-Qualitätsproblem. Es ist
deterministisch, betrifft fast die Hälfte des Katalogs und schaltet dort den
Topic-geführten Tutor ab. Die bisherigen L3-Läufe konnten es nicht sehen, weil
sie nur synthetische Fixtures verwenden.

## 2. Neu formulierte Probleme

### A. EXPAND / Transfer

Sequenz für eine generierte Erweiterungsfrage (Fixture-Pfad):

1. Der Planner stellt die Erweiterungsfrage (`expand-<target>`).
2. Die lernende Person schlägt Änderung und Beobachtung vor.
3. Das Modell bewertet in einem Turn.
4. Der Adapter verbucht genau eine `transfer`-Beobachtung und markiert die
   Erweiterung als benutzt.
5. Der Planner plant wie zu Phasenbeginn: Gibt es keine unbenutzte
   Erweiterung, wählt `selectDeepeningQuestion` eine Topic-Frage. Bevorzugt
   werden nur Fragearten, die das DEEPEN-Kriterium noch braucht; in EXPAND
   ist es erfüllt. Danach entscheiden Gewichte (application 35 > concept 25 >
   prediction = transfer 15) und am Ende die alphabetische ID.

Befunde:

- **Architektur (Konfidenz hoch).** Eine Erweiterung ist nach SSOT und Code
  eine einzelne Frage-Antwort-Einheit. Nach der Antwort bleibt nur „Ziel
  benutzt“ plus eine Rating-Beobachtung. Es gibt keinen Zustand, der eine
  offene Teilfrage des Vorschlags trägt. Die Folgefrage kommt aus einem Pool,
  der für den aktuellen Sketch geschrieben ist.
- **Fixture und Planner (Konfidenz hoch).** Die DEEPEN/EXPAND-Fixtures
  markieren das Topic als gemeistert, ohne LEARN-Evidenz und ohne LEARN-Verlauf.
  Die LEARN-Frage kehrt deshalb als Folgefrage zurück („Welche Ausgabe erzeugt
  Serial.println im aktuellen Sketch?“, 25/25 im v3-Lauf). Fehlende Evidenz
  allein ist aber nicht die Ursache: Der Planner schließt genutzte Fragen nur
  über den Dialogverlauf aus. `progressionHistory` ergänzt `postMasteryEvidence`,
  nicht `masteryEvidence`, und der Start einer DEEPEN/EXPAND-Frage nutzt den
  rohen Verlauf. Nachgestellt (Fake-Provider): Mit ergänzter LEARN-Evidenz
  bleibt die Folgefrage unverändert. Mit realistischem LEARN-Verlauf endet DEEPEN
  sofort in `content-exhausted` (zu wenig Post-Mastery-Fragen), und EXPAND
  serviert die Transferfrage „Wie würdest du die Veränderung von counter … “ auf
  einem Sketch, in dem sich `counter` nie ändert (falsche Prämisse, R-AUT-2).
  Latenter Produktbefund daraus: Ist eine LEARN-Frage aus dem begrenzten
  Dialogfenster gefallen, kann der Planner sie in DEEPEN/EXPAND erneut stellen;
  das widerspricht der Regel, dass strikte Wiederholung keine genutzte
  Question-ID erneut verwendet (TutorQuality-SSOT §3).
- **Produktrelevanz (Konfidenz hoch): gering.** Ohne `extensions` im echten
  Content gibt es dort keine generierten Erweiterungsfragen; EXPAND endet sofort
  in `content-exhausted`. Produktrelevant sind Transferfragen in LEARN/DEEPEN
  (z. B. „Welche gezielte Wertänderung … würdest du … prüfen, und welche
  Beobachtung erwartest du?“). Dort zeigt `strategy-deepen-transfer` dasselbe
  Muster: Ist-Zustand als Korrektur, Ratings aber im Band.
- **Messung (Konfidenz mittel).** `expand-observable-result` 16/16 fasst zwei
  verschiedene Verhaltensweisen zusammen: in v1 echte Fehllesung (Rating 2), in
  v3/v4 teils Annahme mit Rating 4 ohne konkrete Wiederholung der erwarteten
  Werte. Das Kriterium bleibt unverändert, ist aber nicht als ein einziger
  stabiler Fehler zu lesen.

### B. Bewertung korrekter Antworten

| Mögliche Ursache | Befund | Konfidenz |
| --- | --- | --- |
| Modell | Relativierung in rund zwei Dritteln unter v1, v3 und v4, trotz ausdrücklichen Verbots in v3 | hoch |
| `answerRating` | Ratings meist im Band; 4 bedeutet laut SSOT-Rubrik „fachlich korrekt, aber mit kleiner Lücke oder Ungenauigkeit“; das Modell verbalisiert 4 als „Fast richtig“ | hoch |
| fehlende strukturierte Referenz | Die Planner-Daten enthalten keine erwartete Antwort; der Fall ist trotzdem eindeutig genug | mittel |
| Corpus-Semantik | `strategy-learn-strong-answer` („zuerst 3“) und `TQ-SEM-001` (Signalebene statt Codeausdruck) lassen eine „kleine Ungenauigkeit“ zu | mittel |

Produktwirkung: vor allem Wortlaut; Progression unverändert (Erfolg ab Rating 3),
Difficulty-Schritt +2 statt +4. Schwere geringer als in §1.

## 3. Architekturvarianten

| Variante | Nutzen für belegte Probleme | Kosten / Risiko | Entscheidung |
| --- | --- | --- | --- |
| **0. Content- und Gate-Korrektur** (§4) | behebt die schwerste Störung im Betrieb (16/35 Beispiele); deterministisch testbar | Authoring-Entscheidung in UnoSim-Examples; Gate-Erweiterung macht den heutigen Content zunächst rot | **bevorzugt, zuerst** |
| A. Mehrturnige EXPAND-Sequenz (Vorschlag → erwartete Beobachtung → Abschluss) | didaktisch stimmig; macht die lernende Person zur Konkretisierung, statt dass der Tutor sie liefert | neue Produktsemantik (LearningQuestions EXPAND, R-EXP-1..3); Zustand je Erweiterungsziel; im echten Content heute ohne Wirkung (keine `extensions`) | zurückstellen, bis Content Erweiterungen nutzt |
| B. Strukturierter Experiment-Zustand (Änderung / Erwartung / Evidenz) | Obermenge von A; die Evidenz-Stufe bräuchte Laufzeitdaten (LearningQuestions 4.3, „später“) | mehr Zustand, Runtime-Anbindung | YAGNI |
| C. Strukturierte Provider-Einschätzung (beantwortet Frage? korrekt? falsche Zusatzbehauptung?) | verschiebt dasselbe LLM-Urteil in Felder; ändert nicht den Wortlaut | koppelt Planung an LLM-Klassifikation | verworfen |
| D. Anderes Tutor-Modell | einzige noch nicht getestete Stellgröße für Problem B; das Produkt bevorzugt bei `Automatic` Qwen-Modelle, gemessen wurde `openai-gpt5.4-mini` | Calls; keine Produktänderung | als kleiner Versuch nach Variante 0 (§5) |

Variante A, falls später gewählt: Identität ist vorhanden (`expand-<target>`,
`usedExpansionTargetTopicIds`); nötig wären ein Schrittzustand je
Erweiterungsziel (`proposal` → `expectation`), eine zweite anwendungseigene
Frage mit derselben Erkennung wie heute und die Transfer-Evidenz erst nach
Schritt 2. Dazu kommen SSOT-Änderungen in LearningQuestions (EXPAND) und
Evaluation (R-EXP) sowie ein dritter Turn in den EXPAND-Cases.

## 4. Entscheidung und Umsetzung (Variante 0)

Entschieden (User, 2026-10-03): Voraussetzung entfernen, Authoring-Gate
ausbauen, Modellvergleich erst danach.

1. **Content:** `serial-output.prerequisites: [variable-values]` → `[]` und der
   Topic-Hash im Tutor-Manifest. Ziel, Indikator, Fehlvorstellung, Scaffold und
   beide Fragen von `serial-output` verlangen nur `serial-call: print`; die
   Reihenfolge `variable-values` vor `serial-output` bleibt für Sketches mit
   `int` erhalten. PR ttbombadil/UnoSim-Examples#4.
2. **Gate:** Neue katalogweite Invariante im Validator, unabhängig von
   Quality-Cases: Für jedes Example und jedes Topic, das der Matcher darauf
   aktiviert, muss eine lernende Person, die jede geplante Frage erfolgreich
   beantwortet, Topic-Mastery erreichen. Erschöpfung nach schwachen Antworten
   und DEEPEN-Kapazität bleiben ausgenommen. Auf `2ac716f` meldet das Gate genau
   die 16 Beispiele, mit dem Content-Fix keines. TutorQuality-SSOT §4 ergänzt.
   PR MoDevIO/UnoSim#149.
3. **Katalog danach:** Kein Topic mehr ab Start unlösbar (0/36 statt 16/36),
   kein weiteres Topic derselben Klasse. `content-exhausted` tritt nur noch
   **nach** Mastery auf, weil der echte Content kaum Post-Mastery-Fragen und
   keine Erweiterungen hat; das ist ein eigener Authoring-Befund.
4. **Fixtures:** Kein kleiner Corpus-PR. Eine konsistente Progression braucht
   (a) eine Entscheidung zur Wiederholungsregel im Planner (gespeicherte
   Evidenz als „genutzt“ werten; Produktänderung mit L3 vor Merge) und
   (b) mehr Post-Mastery-Fragen sowie eine Transferfrage mit passender
   Applicability in der Anchor-Fixture.

## 5. Modellvergleich (Variante D, vorbereitet, nicht ausgeführt)

Zweck: entscheiden, ob die Relativierung korrekter Antworten modellbedingt ist.

Neubewertung nach Content- und Gate-Fix: weiterhin sinnvoll, aber nachrangig
gegenüber Post-Mastery-Content und der Wiederholungsregel (§4). Die
gewählten Cases sind synthetisch und vom Content-Fix unberührt; Budget und
Schwellen bleiben gültig. Die feste Modell-ID muss der User vorgeben.

- Basis: `main` (Prompt v2-Digest, Prompttext v1), Corpus v7.
- Cases (7): `TQ-SEM-001`, `strategy-learn-strong-answer` (positiv);
  `strategy-learn-weak-answer`, `strategy-deepen-correction`,
  `strategy-expand-wrong-effect` (negativ); `strategy-deepen-transfer`,
  `strategy-expand-observation` (Vorschlag).
- Samples 5; Judge `openai-gpt5.5`.
- Tutor-Modell: eine feste Qwen-Deployment-ID aus der Provider-Modellliste (die
  Familie, die `Automatic` bevorzugt), vom User vor dem Lauf festzulegen.
- Budget pro Modell: 13 Turns × 2 + 7 Judge → `1 + 5 × (26 + 7) = 166`.
  Die bestehenden gpt-5.4-mini-Daten dienen als Vergleich; ein zweites Modell
  kostet weitere 166.

Entscheidungsschwellen:

| Ergebnis | Folgerung |
| --- | --- |
| `correct-answer-rejected` ≤ 1/5 in beiden Positiv-Cases **und** jede Negativkontrolle ≥ 4/5 im Band | modellbedingt; Modellwahl über die Registry/`Automatic`-Politik behandeln, keine Produktänderung |
| ≥ 3/5 in einem Positiv-Case | nicht modellbedingt; Rubrik-4-Semantik und die zwei Corpus-Antworten fachlich prüfen |
| eine Negativkontrolle < 4/5 im Band | Modell nicht geeignet, unabhängig vom Relativierungsbefund |

## 6. Was nicht weiterverfolgt wird

Weitere Promptvarianten (v3/v4 widerlegt bzw. ohne Nutzen, #142 und #146
geschlossen), eine strukturierte Provider-Einschätzung (Variante C),
Keyword-Erkennung von Vorschlägen, Änderungen an Verdict-Regel, Judge oder
Kriterien.
