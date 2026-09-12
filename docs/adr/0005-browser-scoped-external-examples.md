# ADR 0005: Browser-scoped External Examples mit aufgelösten Git-Refs

- Status: Accepted (implemented)
- Date: 2026-09-11
- Owners: UnoSim maintainers and platform operators

## Context

External Examples werden bisher durch serverseitige Source- und Ref-Werte
ausgewählt und in einen prozessweiten Snapshot geladen. Der geplante zusätzliche
Stable-Channel über `channels/stable.json` hätte eine zweite bewegliche
Indirektion, einen gesonderten Publikationspfad und zusätzliche Manifest-Hash-
Verwaltung eingeführt.

Lehrende benötigen stattdessen ein einfaches Modell: Ein öffentlicher Git-Ref
wie `main` darf neue Inhalte veröffentlichen, ohne dass UnoSim neu deployed oder
gestartet wird. Gleichzeitig dürfen Manifest und Dateien während eines Requests
nicht aus unterschiedlichen Ständen stammen. Browser sollen Repository und Ref
lokal überschreiben können, ohne andere Nutzer oder den Server-Default zu
verändern.

## Decision

Das Channel-Modell wird vollständig verworfen. Es gibt keinen logischen
Channel, kein `channels/stable.json` und keinen separaten Publishing-Ref.

Server-/Deployment-Konfiguration liefern Default-Repository und Default-Ref.
Der initiale External-Examples-Default lautet `ttbombadil/unosim-examples` plus
`main`. Der Browser darf dieselben zwei nicht-sensitiven Werte lokal speichern
und request-scoped übertragen. Config und Settings akzeptieren einen Slug oder
eine normale GitHub-Repository-URL mit optionalem `.git`; intern und in der API
gilt ausschließlich der kanonische kleingeschriebene Slug.

External-Examples-Repositories sind zunächst öffentlich. Das Feature löst keine
Vertraulichkeits- oder Private-Repository-Anforderung und besitzt deshalb
keinen GitHub-Login, keine Credential-/Tokenverwaltung, keine Deploy Keys und
keine Browser-Secrets. Sein Sicherheitsziel ist Integrität und kontrollierte
Veröffentlichung öffentlich lesbarer Inhalte.

Ein Ref darf beweglich sein. Nach Ablauf des TTL löst UnoSim ihn serverseitig
über die kontrollierte GitHub-API auf einen vollständigen 40-stelligen
Commit-SHA auf. Manifest und Example-Dateien werden anschließend ausschließlich
über `raw.githubusercontent.com` aus diesem Commit geladen. Erst ein vollständig
geladener und validierter Snapshot wird atomar für die Repository-/Ref-Auswahl
aktiviert.

Die Caches werden nach effektiver Source getrennt:

- Source-Zustand und LKG: `repository + ref`;
- validierter unveränderlicher Snapshot: `repository + revision`.

Ein unveränderter SHA verlängert nur die Source-Prüfung und verwendet denselben
Snapshot. Ein neuer SHA wird vollständig validiert. Bei Fehler bleibt nur der
LKG derselben Repository-/Ref-Auswahl aktiv. Andere Sources sind niemals
Fallback. Identische Default- und Override-Auswahlen dürfen Cache und
Singleflight teilen; das Antwortfeld `selection` bleibt request-spezifisch.

Der Katalog liefert Auswahlart, Repository, Ref, vollständige Revision, Status
und Stale-Zustand. Detailabrufe werden mit Repository und Katalogrevision an
genau diesen Snapshot gebunden und wechseln nicht still auf den inzwischen
neueren Ref-Stand.

Die optionalen Manifestfelder `repository` und `ref` bleiben kompatible
Legacy-Metadaten. Sie bestimmen weder Source noch Revision und werden nicht zur
URL-Bildung verwendet. Neue Manifeste sollen den kanonischen Repository-Slug
angeben und dürfen `ref` weglassen; bestehende Manifeste bleiben strukturell
gültig.

Für das Default-Repository ist `main` der veröffentlichte Stand. Schutz vor
unbeabsichtigten Änderungen liegt organisatorisch und technisch im Examples-
Repository: `main` wird geschützt und Änderungen durch Review- und CI-Prüfungen
freigegeben. UnoSim ergänzt diese Veröffentlichungsgrenze, indem es den Ref
zuerst auf einen Commit-SHA auflöst, den vollständigen Snapshot validiert, erst
danach atomar aktiviert und bei Fehlern den LKG beibehält.

## Authorization and abuse boundary

Der Browser spricht ausschließlich mit UnoSim und kann keine Raw-URL, Hosts,
Allowlists oder Netzwerkgrenzen festlegen. UnoSim konstruiert GitHub-API- und
Raw-GitHub-Ziele serverseitig und behält HTTPS-, Allowlist-, DNS-/SSRF-,
Redirect-, Timeout-, Pfad-, Größen- und Schemaprüfungen bei.

Der Default-Katalog behält seinen bisherigen anonymen Gateway-Vertrag. Validate
und Browser-Overrides benötigen in Gateway Mode einen akzeptierten `user`; Local
Mode verwendet die signierte lokale Session. Dedizierte Rate-, Concurrency-,
Queue-, Source-Cardinality- und Cache-Limits schützen die externe Arbeit.

GitHub-Zugriffe sind ausschließlich credential-freie Lesezugriffe auf
öffentliche Repositories. Rate-Limit- oder Verfügbarkeitsfehler der öffentlichen
GitHub-Endpunkte werden über Retry und source-spezifischen LKG behandelt, nicht
durch Einführung eines geheimen Tokens.

## Consequences

- Maintainer veröffentlichen neue Inhalte durch Fortschreiben des ausgewählten
  Refs, initial `main`; ein zusätzlicher Channel-Workflow entfällt.
- Geschützter `main`, Reviews und CI im Examples-Repository kontrollieren die
  Veröffentlichung; UnoSim muss keine GitHub-Secrets verwalten.
- Jeder tatsächlich geladene Snapshot bleibt über den aufgelösten Commit-SHA
  reproduzierbar und intern immutable.
- Ref-Auflösung benötigt zusätzlich kontrollierten Zugriff auf
  `api.github.com`; Contentzugriff bleibt auf `raw.githubusercontent.com`.
- Apply bleibt transaktional und Reset löscht nur die Browserpräferenz.
- Ein Serverneustart darf den prozesslokalen LKG verlieren; persistente
  LKG-Ablage bleibt außerhalb dieser Entscheidung.

## Rejected alternatives

- **`channels/stable.json`:** verworfen, weil eine zweite bewegliche Indirektion
  und ein eigener Publikationsworkflow für das Ziel unnötig sind.
- **Content über den unaufgelösten Ref `main`:** abgelehnt, weil Manifest und
  Dateien während einer Aktualisierung aus unterschiedlichen Commits stammen
  könnten. `main` als veröffentlichter Ref bleibt ausdrücklich akzeptiert.
- **Private Repositories mit GitHub-Credentials:** nicht Teil des Features, weil
  das Ziel öffentlich lesbare Examples mit Integritäts- statt
  Vertraulichkeitsschutz ist.
- **Browser lädt GitHub direkt:** abgelehnt, weil dies die serverseitige
  Validierungs- und Netzwerkgrenze umgeht.
- **Frei editierbare Raw-URL:** abgelehnt, weil Host- und Pfadkontrolle auf
  untrusted Browserinput verlagert würden.
- **Serverweite Änderung durch Settings:** abgelehnt, weil eine lokale
  Präferenz andere Browser nicht beeinflussen darf.
- **Ein globaler Snapshot oder fremder LKG:** abgelehnt, weil parallele Sources
  dadurch nicht isoliert wären.

## Follow-up boundaries

Syntax, Config-Migration, API, In-Memory-Limits, Cache-Keys und Concurrency sind
im
[`External-Examples-Implementierungsplan`](../EXTERNAL_EXAMPLES_IMPLEMENTATION_PLAN.md)
konkretisiert. Getrennt offen bleibt nur eine mögliche neustartfeste LKG-
Ablage; sie darf Request-Isolation und Commit-Bindung nicht verändern.
