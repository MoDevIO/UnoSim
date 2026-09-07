# UnoSim

Webbasierter Arduino-Simulator mit Editor, Kompilierung, serieller Ausgabe und interaktiver Simulation.

## Einstieg

- [Lokale Installation und Entwicklung](docs/INSTALL_LOCAL.md)
- [Serverinstallation und Hochschulbetrieb](docs/INSTALL_SERVER.md)
- [Sicherheitsmodell](README_SECURITY.md)
- [Dokumentationsindex](docs/README.md)

## Entwicklung

~~~bash
npm ci
npm run check
npm run test:unit
npm run dev:full
~~~

Der lokale Entwicklungsmodus bindet standardmäßig an Loopback und verwendet Local-Simulation. Für Docker-Simulation das Sandbox-Image bauen und INSTALL_LOCAL.md verwenden.

## Build und Tests

~~~bash
npm run build
npm run test:integration
npm run test:docker
npm run test:e2e
./run-tests.sh
~~~

Die Kapazitätsgrenzen sind in SCALABILITY.md dokumentiert. Historische Pläne und Reports liegen im Archiv.
