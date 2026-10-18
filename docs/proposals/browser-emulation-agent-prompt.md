# Auftrag für Umsetzungs-Sessions: Browser-Emulation

> **Nicht normativ.** Startauftrag für Claude-Sessions, die
> [browser-emulation-plan.md](browser-emulation-plan.md) selbstständig umsetzen.
> Wird mit dem Plan gelöscht.
>
> **Start:** In einer frischen Session auf diesem Repository eingeben:
> „Lies docs/proposals/browser-emulation-agent-prompt.md und führe den Auftrag
> aus.“ Jede weitere Session startet mit demselben Satz und setzt beim Stand in
> der Statusdatei fort.
>
> **Voraussetzungen:** `feature/browser-emulation` existiert und ist geschützt
> (grüne Checks erforderlich, kein Review, damit der Agent selbst mergen kann);
> Docker läuft; `SONAR_TOKEN` ist in der Shell gesetzt; die Session läuft in
> einem Berechtigungsmodus, der nicht jeden Befehl einzeln abfragt.

---

Du setzt in diesem Repository (UnoSim) den Plan
`docs/proposals/browser-emulation-plan.md` um. Arbeite selbstständig und so weit
wie möglich. Unterbrich und frag mich nur in den Ausnahmefällen aus Abschnitt 6.

## 1. Vorbereitung

1. Lies vollständig: `docs/proposals/browser-emulation-plan.md`,
   `docs/proposals/browser-emulation.md`, `ssot/ssot_agent_policy.md`,
   `docs/README.md`, `docs/ARCHITECTURE.md`, `docs/SECURITY.md`,
   `docs/TESTING_STANDARDS.md`. Lies vor jedem Arbeitspaket die Dateien, SSOTs
   und ADRs, die es nennt.
2. Prüfe die Voraussetzungen: `origin/feature/browser-emulation` existiert,
   `SONAR_TOKEN` ist gesetzt, Docker läuft, `arduino-cli` mit
   `arduino:avr@1.8.8` ist installiert. Fehlt der Branch oder der Token, halte
   an und melde es.
3. Lies `docs/proposals/browser-emulation-status.md` auf
   `origin/feature/browser-emulation`. Gibt es die Datei nicht, legst du sie im
   ersten PR nach der Vorlage in Abschnitt 7 an. Sie ist der Fortschrittsstand
   über alle Sessions hinweg; halte sie in jedem PR aktuell.

## 2. Reihenfolge

Beginne beim ersten Paket, das in der Statusdatei nicht als erledigt steht.
Halte die Reihenfolge und die Abhängigkeiten aus Plan-Abschnitt 5 ein: P0.1 (nur
Entwürfe, Status `Proposed`), P0.2, P0.4, P0.5, P0.6, dann Phase 1, Phase 2,
Phase 3 bis M1, dann Phase 7 (ohne P7.3) und die Phasen 4 bis 6. P0.7 ist
erledigt, sobald der Branch existiert.

Was eine Person braucht, überspringst du und trägst es als „wartet auf Mensch“
ein: Messungen auf Referenzgeräten (P0.3), Aufnahmen am echten Board (Klasse
`hardware` in P1.14 und in den Board-Phasen), Erprobung im Unterricht (P7.3).
Alles andere an diesen Paketen (Formate, Skripte, Fälle der Klassen `derived`
und `regression`) setzt du um.

## 3. Ablauf je Arbeitspaket

1. Arbeitsbranch vom aktuellen `origin/feature/browser-emulation`, benannt nach
   `<typ>/<paket>-<kurzname>`, z. B. `docs/p0-1-adr-drafts`,
   `spike/p0-4-runtime-io`, `feat/p1-4-pin-model`.
2. Umsetzen, was der Plan für das Paket nennt (Inhalt, Dateien, Abnahme).
   Normative Dokumente (ADR, SSOT, ARCHITECTURE, SECURITY, USER_GUIDE usw.)
   ändern sich im selben PR wie der Code (Plan-Abschnitt 8).
3. Lokal prüfen: `npm run check`, `npm run lint`, `npm run test:unit`,
   `npm run check:docs`. Berührt das Paket Toolchain, Docker oder UI, zusätzlich
   `npm run test:integration`, `npm run test:docker` bzw. `npm run test:e2e`.
   Vor E2E den Client neu bauen.
4. Commits: Conventional Commits auf Englisch, Header höchstens 100 Zeichen, mit
   der Attribution, die deine Umgebung vorgibt. Korrekturen als neue Commits.
5. Push: Der Pre-Push-Hook (Unit-Tests und Sonar-Scan) muss grün sein. Meldet
   Sonar einen neuen Befund, frag ihn über den MCP-Server `sonarqube` oder die
   API auf `localhost:9000` ab und behebe ihn.
6. PR gegen `feature/browser-emulation`, nie gegen `main`. Beschreibung:
   Paket-ID, was umgesetzt ist, Abnahmeevidenz (Befehle, Messwerte,
   Testnamen), Abweichungen vom Plan, geänderte bestehende Tests mit Begründung.
7. CI abwarten (`gh pr checks <nr> --watch`). Grün: mergen mit
   `gh pr merge <nr> --merge --delete-branch`. Rot: Ursache beheben, neuer
   Commit, erneut.
8. Pakete der Größe L in mehrere PRs teilen, jeder für sich grün und sinnvoll.

## 4. Spikes und ADRs

- Jeder Spike endet mit einem Bericht
  `docs/proposals/spike-<paket>-<thema>.md`, als nicht normativ gekennzeichnet
  wie der Plan: Ziel, Aufbau, Messwerte, Kriterium erfüllt ja/nein, Folgen für
  die Entscheidungen E1–E16. Prototypcode gehört in den Bericht oder unter
  `spikes/<paket>/`, nicht in den Produktcode.
- ADR 0009 und ADR 0010 legst du als Entwurf (Status `Proposed`) an und
  ergänzt sie mit den Spike-Ergebnissen. Auf `Accepted` setzt du sie nicht; das
  entscheide ich.

## 5. Regeln

- Nie: `git push --no-verify`, Amend oder Force-Push gepushter Commits, Rebase
  von `feature/browser-emulation`, Push oder PR gegen `main`, fremde Branches
  löschen, Sicherheitsvorgaben (Gateway, Sandbox, Limits) abschwächen, Secrets
  lesen oder ausgeben.
- Bestehende Tests: Für die Änderungen in Plan-Abschnitt 7.3 erteile ich hiermit
  die Freigabe; begründe jede im PR. Das Nachziehen von Imports oder Typen ist
  ebenfalls erlaubt. Jede andere Änderung an bestehenden Tests, vor allem eine
  abgeschwächte oder entfernte Prüfung, ist ein Ausnahmefall.
- Visuelle Snapshots nie mit `--update-snapshots` erneuern; geänderte Snapshots
  sind ein Ausnahmefall.
- Weicht der Code vom Plan ab (andere Datei, andere API), entscheide im Sinne
  des Plans, dokumentiere es im PR unter „Abweichungen“ und korrigiere den Plan
  im selben PR.
- Neue Laufzeitabhängigkeit nur avr8js, exakt gepinnt. Neue
  Dev-Abhängigkeiten nur mit Begründung im PR.
- Mit Board `uno` und Backend `host-mock` als Default bleibt jedes bisherige
  Verhalten unverändert, solange der Plan nichts anderes festlegt.
- Arbeitest du in einem Git-Worktree, verlinke `node_modules`, damit die Hooks
  laufen.

## 6. Ausnahmefälle: nur dann anhalten und fragen

1. Ein Spike verfehlt sein Kriterium, oder ein Ergebnis widerspricht einer
   Entscheidung E1–E16.
2. Eine Entscheidung ist nötig, die der Plan nicht trifft, und sie betrifft
   Sicherheit, die Verträge (REST, WebSocket, iframe), Datenschutz oder das
   Verhalten im Unterricht.
3. Eine Teständerung liegt außerhalb der Freigabe in Abschnitt 5.
4. Etwas braucht Hardware, Geräte, Zugangsdaten, Admin-Rechte im Repository oder
   kostet Geld.
5. Ein Gate bleibt nach drei ernsthaften Versuchen rot, und die Ursache liegt
   außerhalb des Pakets.

Bevor du fragst, bearbeite alle Pakete weiter, die davon nicht abhängen. Frag
knapp: Problem, Optionen, deine Empfehlung.

## 7. Ende der Session und Statusdatei

Wird der Kontext knapp oder ist alles Mögliche erledigt: Statusdatei
aktualisieren und per PR mergen, dann zusammenfassen: erledigte Pakete mit
PR-Links, offene, wartende und blockierte Pakete, nächster Schritt. Die nächste
Session startet mit diesem Auftrag.

Vorlage für `docs/proposals/browser-emulation-status.md`:

```markdown
# Umsetzungsstand Browser-Emulation

> **Nicht normativ.** Fortschritt zu [browser-emulation-plan.md](browser-emulation-plan.md);
> wird mit dem Plan gelöscht.

| Paket | Status | PR | Notiz |
|---|---|---|---|
| P0.1 | offen | | |

Status: offen · in Arbeit · erledigt · wartet auf Mensch · blockiert
```
