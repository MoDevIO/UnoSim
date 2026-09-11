# ADR 0005: Browser-scoped External Examples mit Stable Channel

- Status: Accepted (target architecture; implementation pending)
- Date: 2026-09-11
- Owners: UnoSim maintainers and platform operators

## Context

External Examples werden bisher ausschließlich durch serverseitige Source- und
Ref-Werte ausgewählt und beim ersten Katalogzugriff in einen prozessweiten
Snapshot geladen. Jede neue Example-Version benötigt deshalb eine Änderung der
Deployment-Konfiguration beziehungsweise einen Neustart. Lehrende sollen
Example-Inhalte über ein GitHub-Repository pflegen und eine Repository-Auswahl
in ihren eigenen UnoSim-Settings verwenden können, ohne globale Einstellungen
anderer Nutzer zu verändern.

Eine frei eingegebene Raw-URL oder ein direkter Browserzugriff auf GitHub würde
die bestehende SSRF-, Validierungs- und Netzwerkgrenze umgehen. Ein einzelner
globaler Source-Snapshot ist zugleich unvereinbar mit parallelen Browsern, die
unterschiedliche Repositories gewählt haben.

## Decision

Die Server-/Deployment-Konfiguration bleibt Default-Quelle. Der Browser darf
eine nicht-sensitive, normalisierte Auswahl aus GitHub-Repository-Slug und
optionalem logischen Channel in `localStorage` speichern. Diese Auswahl wird
request-scoped als typisierte API-Parameter an UnoSim übertragen. Sie verändert
weder Environment noch serverweiten Default und wird serverseitig nicht als
Nutzerprofil gespeichert.

Der Browser spricht ausschließlich mit UnoSim. Der Server bildet den Slug auf
operatorseitig erlaubte GitHub-/Raw-GitHub-Ziele ab und erzwingt alle bestehenden
SSRF-, Host-, Pfad-, Redirect-, Timeout-, Größen- und Schemaregeln. Der Browser
kann keine Raw-Basis-URL und keine Lockerung dieser Regeln liefern.

Ein logischer Channel wie `stable` verweist über ein kleines, strikt
validiertes Channel-Dokument auf einen vollständigen Commit-SHA und den
SHA-256-Hash seines Manifests. Nur das Channel-Dokument darf über einen bewusst
beweglichen Publikationspfad bezogen werden. Manifest und Dateien werden nie
aus `main` oder einem anderen frei beweglichen Inhalts-Ref geladen, sondern nur
aus dem vollständigen Commit-SHA. Eine Revision wird erst nach vollständigem
Download und erfolgreicher Validierung atomar aktiviert. Bei Fehler bleibt der
Last-Known-Good-Snapshot derselben Repository-/Channel-Auswahl aktiv.

Die Caches werden nach effektiver Source identifiziert:

- Channelstatus/LKG: `repository + channel`;
- validierter unveränderlicher Snapshot: `repository + revision`.

Damit dürfen mehrere Browser denselben unveränderlichen Snapshot teilen, ohne
dass ihre Auswahl global geteilt wird. Ein Snapshot einer anderen Source darf
nie als Fallback dienen. Caches sind begrenzte, regenerierbare Betriebsdaten,
keine Speicherung von Nutzereinstellungen.

Der Katalog liefert Auswahlart (`default` oder `browser-override`), kanonisches
Repository, Channel, aktive Revision, `status` und `stale`. Detailabrufe werden
mit der Katalogrevision gebunden. Die vollständige fachliche UI-, API-,
Persistenz- und Fehlerspezifikation steht in
[`../../ssot/ssot_function_definition_ExternalExamples.md`](../../ssot/ssot_function_definition_ExternalExamples.md).

## Authorization and abuse boundary

Der bestehende Default-Katalog darf seinen bisherigen Zugriffsvertrag behalten.
Das erstmalige Auflösen eines Browser-Overrides erzeugt jedoch kontrollierbare
externe Arbeit und neue Cache-Keys. In Gateway-Mode wird ein Override deshalb
nur für einen durch ADR 0001 akzeptierten `user` ausgewertet; anonyme Requests
dürfen nur den Default verwenden. Local mode verwendet seine serverseitig
signierte lokale Sessionidentität. Override-Auflösung erhält eigene Rate-,
Parallelitäts- und Source-Cardinality-Grenzen.

Für Requests mit Override-Auswahl ersetzt diese Entscheidung die allgemeine
anonyme Freigabe von `GET /api/examples` aus der Ressourcenmatrix von ADR 0001;
für Requests ohne Override bleibt jene Freigabe unverändert. Gateway-Secret und
Rollenmodell ändern sich nicht. Repository und Channel sind nicht sensitiv und
dürfen in Requests und Antworten erscheinen, dürfen aber keine Credentials
enthalten.

## Consequences

- Nach einmaliger Betreiberkonfiguration können berechtigte Repository-
  Maintainer neue Example-Releases ohne UnoSim-Deployment veröffentlichen.
- Apply ist transaktional: Der Browser persistiert erst nach erfolgreicher
  Kandidatenvalidierung. Reset löscht nur die lokale Präferenz.
- Channel-Refresh benötigt keinen Serverneustart und ersetzt niemals bereits im
  Editor geöffnete Dateien.
- Cache- und Rate-Limit-Implementierung wird komplexer, weil Source-Cardinality
  statt eines einzigen globalen Snapshots berücksichtigt werden muss.
- Ein Serverneustart darf den initial nur prozesslokalen LKG-Cache verlieren;
  neustartfeste LKG-Persistenz ist nicht Teil dieser Entscheidung.
- Die aktuelle Implementierung erfüllt diese Zielarchitektur noch nicht. Ihre
  Einführung benötigt API-, Config-, Service-, UI- und Teständerungen in einem
  gesonderten Umsetzungsschritt.

## Rejected alternatives

- **Browser lädt GitHub direkt:** abgelehnt, weil es die serverseitige
  Validierungs- und Netzwerkgrenze umgeht und zusätzliche Browser-CSP/CORS-
  Abhängigkeiten schafft.
- **Frei editierbare Raw-Content-URL:** abgelehnt, weil URL- und Hostkontrolle
  unnötig auf untrusted Browserinput verlagert würden.
- **Serverweite Änderung durch Settings:** abgelehnt, weil eine Nutzerpräferenz
  nicht den Zustand anderer Browser verändern darf.
- **Produktionsinhalt direkt aus `main`:** abgelehnt, weil Katalog und Dateien
  während eines Updates inkonsistent werden können und kein reproduzierbarer
  Snapshot entsteht.
- **Ein globaler Examples-Snapshot:** abgelehnt, weil parallele, unterschiedliche
  Browser-Auswahlen damit nicht korrekt isoliert werden können.
- **LKG eines anderen Repositorys als Fallback:** abgelehnt, weil die Antwort
  nicht mehr der angefragten Source entspräche.

## Open implementation decisions

Vor Implementierungsbeginn werden der konkrete geschützte Channel-
Publikationspfad, numerische Abuse-/Cache-Grenzen, Config-Migrationsnamen und
eine mögliche neustartfeste LKG-Ablage festgelegt. Diese Details dürfen die
hier entschiedene Hierarchie, Request-Isolation, Commit-Bindung oder
Sicherheitsgrenze nicht verändern.
