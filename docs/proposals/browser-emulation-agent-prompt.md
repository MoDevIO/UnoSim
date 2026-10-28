# Auftrag für Umsetzungs-Sessions: Browser-Emulation (Stand nach M3)

> **Nicht normativ.** Startauftrag für Claude-Sessions, die
> [browser-emulation-plan.md](browser-emulation-plan.md) selbstständig zu Ende
> umsetzen. Wird mit dem Plan gelöscht.
>
> **Start:** In einer frischen Session auf diesem Repository eingeben:
> „Lies docs/proposals/browser-emulation-agent-prompt.md und führe den Auftrag
> aus.“ Jede weitere Session startet mit demselben Satz und setzt beim Stand in
> der Statusdatei fort.
>
> **Voraussetzungen:** Docker läuft; `arduino-cli` 1.5.x mit
> `arduino:avr@1.8.8`; `SONAR_TOKEN` steht in `~/.zshrc.local` (nicht im
> Repository); die Session läuft in einem Berechtigungsmodus, der nicht jeden
> Befehl einzeln abfragt. **Mergen darf die Session nicht** (Abschnitt 3).

---

Du führst in diesem Repository (UnoSim) den Plan
`docs/proposals/browser-emulation-plan.md` zu Ende. Alle Arbeitspakete sind
umgesetzt; M1, M2 und M3 sind mit ausgewiesenen Ausnahmen abgenommen. Offen
ist fast nur noch Arbeit von Menschen (Messungen, Aufnahmen, ADR-Annahme,
Beta und Unterricht). Arbeite selbstständig und so weit wie möglich.
Unterbrich und frag nur in den Ausnahmefällen aus Abschnitt 7.

## 1. Stand (24.10.2026)

- `feature/browser-emulation` ist grün. Uno `available`, Nano, Mega 2560 und
  ATtiny85 `preview` (`shared/boards.ts`). Lokal ist die Browser-Emulation
  Standard. Im Docker-Profil kompiliert jeder Compile in der Compile-Sandbox,
  `browser` ist dort anbietbar; der Standard bleibt `host-mock` bis M4 (die
  Pilot-Instanz setzt `UNOSIM_DEFAULT_RUNTIME=browser`).
- Abnahmeberichte: [M1](report-m1-acceptance.md), [M2](report-m2-acceptance.md),
  [M3](report-m3-acceptance.md). Fortschritt je Paket:
  [browser-emulation-status.md](browser-emulation-status.md) (lies sie zuerst).
- Korpus: 98 Fälle (Uno 65, Nano 7, Mega 21, ATtiny85 5), davon 45 Klasse
  `hardware` (alle vom Uno) in `tests/fixtures/runtime-corpus/`.
- Bundle: initialer Ladepfad 691,0 kB von 710 kB (`npm run check:bundle`).
- Was nur ein Mensch tun kann, steht mit Anleitung in
  [human-tests.md](human-tests.md) (Teile 1–7).

**Was noch offen ist:**

| Paket | Stand | Deine Aufgabe |
|---|---|---|
| P0.1 / M0 | ADR 0009/0010 `Proposed` | keine; Annahme durch die Maintainer |
| P0.3 | synthetisch erledigt | Messwerte eines echten Geräts (human-tests Teil 1) in den Bericht übernehmen, falls geliefert |
| P1.14, M2, M3 (Klasse `hardware`) | Uno 44/64, sonst `derived` | gelieferte Aufnahmen prüfen; Abweichungen sind Befunde (Emulation oder Herleitung korrigieren, begründet) |
| P4.6 | README von UnoSim-Examples | keine (anderes Repository; Text in human-tests Teil 6) |
| P7.1 | Messung auf dem Referenz-Host | gelieferte Tabelle in CAPACITY_MODEL übernehmen |
| P7.3 | Beta vorbereitet (Entwurfs-PR, Runbook) | Befunde aus dem Pilot als PRs beheben |
| M4 | wartet auf P7.3 und die Kriterien in RELEASE_RUNBOOK | nach Freigabe durch einen Menschen: Standardwerte des Docker-Profils auf `browser`, dann PR `feature/browser-emulation` → `main` vorbereiten (mergen nur ein Mensch) |

**Bekannte Risiken:**

- **Zeitbudget `test:coverage` in CI:** Der Teil `unit-coverage` liegt auf
  GitHub-Runnern bei 71–125 s (Grenze 120 s) und reißt sie gelegentlich (am
  23.10.2026 einmal, Wiederholung grün). Lösche keine Tests, um ein Budget
  einzuhalten; teile den Lauf oder begründe eine Anhebung mit Messwerten.
- **avr8js-Korrekturen** (`AVR8JS-PATCHES` in OPEN_POINTS): Ein Update von
  avr8js kann sie brechen; vorher die Tests der Profile laufen lassen.
- **Portleiste des Serial Monitors** (Mega, #319): noch von keinem Menschen
  angesehen.

## 2. Reihenfolge

1. Offene PRs: CI-Stand prüfen, Rotes lesen und beheben (Budget, Flake oder
   Fehler unterscheiden), grüne PRs mit Merge-Befehl melden.
2. Ergebnisse von Menschen einarbeiten, sobald sie vorliegen (Tabelle oben):
   Aufnahmen, Messungen, Issue-Links, Rückmeldungen aus dem Pilot.
3. Befunde aus Pilot und Unterricht als kleine PRs gegen den Integrationsbranch.
4. Offene Punkte der Browser-Emulation in [OPEN_POINTS.md](../OPEN_POINTS.md)
   (`EMU-*`, `EDITOR-INDENT`) nur nach einer Entscheidung eines Menschen.

Was eine Person braucht, überspringst du und trägst es als „wartet auf Mensch“
ein: Messungen auf Referenzgeräten (P0.3), Aufnahmen an echter Hardware
(Klasse `hardware` für Nano, Mega, ATtiny85), Erprobung im Unterricht (P7.3),
die Annahme der ADRs, das README von UnoSim-Examples (anderes Repository, nicht
anfassen), das Merge von PRs. Alles andere an diesen Paketen setzt du um.

## 3. Ablauf je Arbeitspaket

1. **Vorher:** `git status`, `gh pr list`, CI-Stand von `feature/browser-emulation`
   (`gh run list --branch feature/browser-emulation --limit 1`), `docker info`,
   `arduino-cli version`. Prüfe das Token, ohne es auszugeben:
   `curl -s -u "$SONAR_TOKEN:" http://localhost:9000/api/authentication/validate`
   muss `{"valid":true}` liefern (SonarQube läuft nur auf `127.0.0.1:9000`).
2. Arbeitsbranch vom aktuellen `origin/feature/browser-emulation`, benannt
   `<typ>/<paket>-<kurzname>` (z. B. `feat/p2-4-compile-sandbox`).
3. Umsetzen, was der Plan für das Paket nennt. Normative Dokumente (ADR, SSOT,
   ARCHITECTURE, SECURITY, USER_GUIDE, INSTALL_*, CAPACITY_MODEL,
   RELEASE_RUNBOOK) ändern sich im selben PR wie der Code (Plan-Abschnitt 8).
4. Lokal prüfen: `npm run check`, `npm run lint`, `npm run test:unit`,
   `npm run check:docs`, `npm run check:bundle`, `npx knip`. Berührt das Paket
   Toolchain, Docker oder UI, zusätzlich `npm run test:integration`,
   `npm run test:docker` bzw. `npm run test:e2e`. **Vor E2E den Client neu
   bauen** (`npm run build`); die E2E-Tests laufen gegen den gebauten Client.
5. Commits: Conventional Commits auf Englisch, Header höchstens 100 Zeichen, mit
   der Attribution, die deine Umgebung vorgibt. Korrekturen als **neue**
   Commits, nie Amend, nie Force-Push gepushter Commits, nie `--no-verify`.
6. Push: Der Pre-Push-Hook (Unit-Tests und Sonar-Scan) muss grün sein. Meldet
   Sonar einen neuen Befund, behebe ihn (MCP-Server `sonarqube` oder die API auf
   `localhost:9000`).
7. PR gegen `feature/browser-emulation`, nie gegen `main`. Beschreibung auf
   Deutsch: Paket-ID, was umgesetzt ist, Abnahmeevidenz (Befehle, Messwerte,
   Testnamen), Abweichungen vom Plan, geänderte bestehende Tests mit Begründung.
8. **CI abwarten, aber nicht mit Dauerschleifen:** `gh pr checks <nr>` einzeln
   abfragen, oder eine Hintergrundschleife (`until … ; do sleep 5; done` mit
   `run_in_background`). Rot: Ursache beheben, neuer Commit. **Wirklich lesen,
   was rot ist:** ein Zeitbudget, ein Flake und ein Testfehler brauchen
   verschiedene Antworten.
9. **Mergen darf nur ein Mensch.** Die Berechtigungsprüfung dieser Umgebung
   verweigert `gh pr merge` („Merge Without Review“). Umgehe das nicht. Melde
   den PR als „grün, bereit zum Merge“ mit dem fertigen Befehl
   (`gh pr merge <nr> --merge --delete-branch`) und arbeite an Paketen weiter,
   die nicht davon abhängen. Hängt das nächste Paket am offenen PR, baue es auf
   dessen Branch (gestapelt) und führe nach dem Merge `origin/feature/browser-emulation`
   in deinen Branch ein (Merge, kein Rebase, kein Force-Push).
10. **Nach dem Merge aufräumen:** auf `feature/browser-emulation` wechseln,
    `git merge --ff-only origin/feature/browser-emulation`, Arbeitsbranch lokal
    (`git branch -d`) und auf GitHub (`gh api -X DELETE repos/MoDevIO/UnoSim/git/refs/heads/<branch>`)
    löschen. Am Ende einer Session soll es lokal nur `main` und
    `feature/browser-emulation` geben, keinen Stash, keine unversionierten
    Dateien außer `UnoSim.code-workspace` (gehört dem Nutzer).
11. Pakete der Größe L in mehrere PRs teilen.

## 4. Spikes, ADRs, Abnahmeberichte

- Jeder Spike endet mit einem Bericht `docs/proposals/spike-<paket>-<thema>.md`,
  nicht normativ: Ziel, Aufbau, Messwerte, Kriterium erfüllt ja/nein, Folgen für
  die Entscheidungen E1–E16.
- ADR 0009 und 0010 bleiben `Proposed`; auf `Accepted` setzt sie ein Mensch.
- Jeder Meilenstein bekommt `report-<m>-acceptance.md` nach dem Muster von
  M1/M2: Kriterien mit Beleg, E2E-Szenarien, Messwerte (**selbst erhoben, mit
  Gerät und Befehl**), Funde, Restpunkte. Weise Ausnahmen offen aus; trage nichts
  als erledigt ein, was nur hergeleitet (`derived`) ist.

## 5. Regeln

- Nie: Push oder PR gegen `main`, Rebase von `feature/browser-emulation`,
  fremde Branches löschen, Sicherheitsvorgaben (Gateway, Sandbox, Limits)
  abschwächen, Secrets lesen oder ausgeben (auch nicht in Zusammenfassungen und
  Tool-Ausgaben: Werte maskieren). Neue Secrets gehören in `~/.zshrc.local`,
  nicht ins Repository.
- Bestehende Tests: Für die Änderungen in Plan-Abschnitt 7.3 gilt die Freigabe;
  begründe jede im PR. Imports und Typen nachziehen ist erlaubt. Jede andere
  Änderung, vor allem eine abgeschwächte oder entfernte Prüfung, ist ein
  Ausnahmefall. (Zuletzt freigegeben und begründet: sieben doppelte oder leere
  Docker-Tests, #317. Prüfe ein Gate auf Nutzen, bevor du ein Budget anhebst.)
- Visuelle Snapshots nie mit `--update-snapshots` erneuern.
- Weicht der Code vom Plan ab, entscheide im Sinne des Plans, dokumentiere es im
  PR unter „Abweichungen“ und korrigiere den Plan im selben PR.
- Neue Laufzeitabhängigkeit nur `avr8js`, exakt gepinnt. Neue
  Dev-Abhängigkeiten nur mit Begründung im PR.
- `config.ts` lehnt entfernte Variablen ab (`DOCKER_COMPILE_CONCURRENT` u. a.);
  der Dev-Starter und `run-tests.sh` räumen sie weg. Neue Ablehnungen gehören in
  alle drei Listen (ein Vertragstest prüft das).

## 6. Gelerntes aus den bisherigen Sessions

- **Stash nie vorschnell löschen.** `git stash show` zeigt unversionierte Dateien
  nicht; sie liegen im dritten Elternteil (`git show --stat <stash>^3`). Bevor
  du etwas verwirfst, liste alles, auch Ignoriertes. Lege Arbeit lieber auf
  einen Branch als in einen Stash. `git restore --source=<x> -- .` gleicht den
  ganzen Baum an und löscht alles andere: nur mit konkreten Pfaden.
- **Verweigert die Berechtigungsprüfung eine Aktion** (Merge, `git stash drop`,
  Löschen unversionierter Dateien, `git gc`), umgehe es nicht. Mach den Rest
  fertig und nenne dem Menschen den genauen Befehl samt Grund.
- **Terminal-Umgebung:** VS Code stellt Terminals mit ihrer alten Umgebung
  wieder her. Eine Variable, die in keiner Datei steht, kommt von dort. `ps`
  zeigt unter macOS die Umgebung fremder Prozesse nicht.
- **Vite:** Abhängigkeiten, die nur der Worker lädt (`new Worker(new URL(…))`),
  findet der Vorab-Scan nicht und die Seite lädt beim ersten Lauf neu. Neue
  solche Pakete kommen in `optimizeDeps.include`.
- **Docker-Gate:** Die Tests laufen seriell mit echten Containern (rund 125 s
  lokal) und schwanken auf dem Runner zwischen 120 und 185 s. Das Image
  `unosim-sandbox:latest` muss vorhanden sein.
- **E2E:** Läuft schon ein Server auf Port 3000, testest du ihn statt des
  Prüflings; offline-Mutationen von React Query brauchen `networkMode: "always"`.
  Weitere Fallen stehen im Memory dieses Projekts
  (`~/.claude/projects/-Users-to-Documents-TT-Web-UnoSim/memory/`).
- **Zahlen im Bericht selbst messen.** Leistung mit
  `npm run emulate -- <hex> --board <id> --ms 1500 --repeat 7`, Korpus aus den
  `case.json`, Bundle mit `npm run check:bundle`.

## 7. Ausnahmefälle: nur dann anhalten und fragen

1. Ein Spike verfehlt sein Kriterium, oder ein Ergebnis widerspricht einer
   Entscheidung E1–E16.
2. Eine Entscheidung ist nötig, die der Plan nicht trifft, und sie betrifft
   Sicherheit, die Verträge (REST, WebSocket, iframe), Datenschutz oder das
   Verhalten im Unterricht.
3. Eine Teständerung liegt außerhalb der Freigabe in Abschnitt 5.
4. Etwas braucht Hardware, Geräte, Zugangsdaten, Admin-Rechte im Repository,
   einen Merge oder kostet Geld.
5. Ein Gate bleibt nach drei ernsthaften Versuchen rot, und die Ursache liegt
   außerhalb des Pakets.
6. Für `v2.0.0` ist eine Entscheidung nötig (Versionsnummer, Tag, CHANGELOG,
   Zeitpunkt der Pilot-Instanz): das legt ein Mensch fest.

Bevor du fragst, bearbeite alle Pakete weiter, die davon nicht abhängen. Frag
knapp: Problem, Optionen, deine Empfehlung.

## 8. Ende der Session und Statusdatei

Wird der Kontext knapp oder ist alles Mögliche erledigt: Statusdatei
aktualisieren (Zeile je Paket, PR-Nummern statt „dieser PR“), per PR einbringen,
den Arbeitsstand aufräumen (Abschnitt 3, Punkt 10) und zusammenfassen: erledigte
Pakete mit PR-Links, offene PRs mit Merge-Befehlen, wartende und blockierte
Pakete, nächster Schritt. Die nächste Session startet mit diesem Auftrag.

Format der Statusdatei: siehe die vorhandene
[browser-emulation-status.md](browser-emulation-status.md). Status ist einer von
offen · in Arbeit · erledigt · wartet auf Mensch · blockiert.
