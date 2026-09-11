# ADR 0004: Repository-basierte Tutorsteuerung (Pilot)

- Status: Accepted (Pilot)
- Date: 2026-09-11
- Scope: genau ein Topic, `memory-and-data-types`

## Entscheidung

Didaktische Inhalte werden als versionierte YAML-Daten in einem separaten
Curriculum-Repository gepflegt. UnoSim lädt serverseitig nur ein Manifest und
die darin explizit referenzierten Topic-Dateien. In Produktion wird ein
vollständiger Commit-SHA verwendet. Der Browser kommuniziert niemals mit
GitHub.

Der Inhalt wird vor der Verwendung mit einem strikten Schema, Größenlimits,
Referenzprüfung und einer azyklischen Concept-Dependency-Prüfung validiert.
Repository-Daten werden zu einem normalisierten `DidacticBrief` kompiliert.
Nur dieser Brief darf als strukturierter User-Kontext an den bestehenden
Tutor-Provider gelangen. Der serverseitige Systemprompt bleibt
Anwendungscode; Curriculum-Text wird niemals an ihn angehängt.

Der Pilot besitzt keine dauerhafte Lernhistorie, kein Analytics-System und
keinen signierten Lernzustand. Die Concept Map wird aus dem begrenzten,
sessionbezogenen Dialogverlauf im Browser-RAM rekonstruiert. Wenn kein
validiertes Topic zum Sketch passt oder der Curriculum-Snapshot nicht
verfügbar ist, läuft der bisherige freie Tutor unverändert weiter.

Die im UnoSim-Arbeitsbaum liegenden Dateien unter `curriculum/` sind
Pilot-Fixtures bzw. ein Authoring-Beispiel. Sie werden von der Produktion
nicht automatisch gelesen und sind keine zweite Quelle der Wahrheit. Der
produktive Pfad ist ausschließlich die über
`UNOSIM_TUTOR_CURRICULUM_SOURCE` konfigurierte HTTPS-Quelle mit dem
zugehörigen vollständigen Commit-SHA.

## Komponenten

```text
DidacticContentRepository
  -> SketchFactExtractor
  -> TopicMatcher
  -> LearningPlanner
  -> TutorService
  -> bestehender LLMProvider
```

Der Planner wählt Fragen, Scaffolds und Übergänge deterministisch. Das LLM
bewertet die aktuelle Antwort und formuliert kurzes Feedback. Die Bewertung
`1..2`, `3`, `4` und `5` wird vom Planner in Remediation, Clarification,
Indicator-Prüfung bzw. Mastery-/Progressionsprüfung übersetzt.

## Sicherheitsgrenzen

- Nur HTTPS und explizit allowlistete Hosts.
- Keine Redirects, keine IP-Literale, keine privaten Zieladressen.
- Fester Commit-SHA, Manifest-Hashes und Last-known-good nur für denselben
  Commit.
- Keine freien Regex, URLs, Promptrollen oder ausführbaren Regeln im YAML.
- Nur geschlossene Fact-Matcher, Fragearten und Scaffolding-Strategien.
- Topic-Dateien, IDs, Textfelder und Graphen besitzen feste Größenlimits.
- Ungültiger oder nicht geladener Curriculum-Inhalt aktiviert keinen Teil-
  Snapshot, sondern den freien Tutor-Fallback.

## Nicht Teil des Piloten

- persönliche Speicherung über einen Reload oder Durchlauf hinaus,
- serverseitige Kompetenzprofile,
- Analytics-/Experience-Events,
- automatische Curriculum-Änderungen durch Modellantworten,
- GitHub-Schreibzugriff aus UnoSim.

Eine spätere dauerhafte Lernhistorie benötigt eine eigene SSOT-/ADR-
Entscheidung. Der bestehende Vertrag für flüchtige Dialoghistorie bleibt
damit unverändert.
