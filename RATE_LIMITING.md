# Rate Limiting für Simulation Starts

## Übersicht

Das System implementiert **Pro-Client Rate Limiting** für die Simulation-Starts, um den Server vor Überbelastung zu schützen.

---

## Wie funktioniert es?

### Limits (Standard)

- **Max. 1 Start pro 2 Sekunden pro Client**
- Wenn überschritten: **5 Sekunden Blockade**
- Sliding Window (zeitbasiert, nicht Token-basiert)

### Flow

```
Client sendet "start_simulation"
            ↓
Rate Limiter prüft Client-ID (WebSocket)
            ↓
Ist Client blockiert? → JA → Fehler senden (retry in 30s)
            ↓ NEIN
Hatte Client zu viele Starts in letzten 60s? → JA → Blockieren
            ↓ NEIN
Simulation starten ✅
```

---

## Konfiguration

### Standard-Werte ändern

In `server/routes.ts` beim Initialisieren:

```typescript
import { getSimulationRateLimiter } from "./services/rate-limiter";

// Beispiel: 2 Starts pro 5 Sekunden
const rateLimiter = getSimulationRateLimiter({
  maxRequests: 2,           // 2 Starts
  windowMs: 5 * 1000,       // pro 5 Sekunden
  blockDurationMs: 10 * 1000 // dann 10s blockieren
});
```

### Produktion vs. Entwicklung

```typescript
// Produktion: Strikte Limits (1 pro 2 Sekunden)
const config = {
  maxRequests: 1,
  windowMs: 2 * 1000,
  blockDurationMs: 5 * 1000
};

// Lockerer: 2 pro 3 Sekunden
const config = {
  maxRequests: 2,
  windowMs: 3 * 1000,
  blockDurationMs: 10 * 1000
};

// Entwicklung: Sehr locker (5 pro 5 Sekunden)
const config = {
  maxRequests: 5,
  windowMs: 5 * 1000,
  blockDurationMs: 5 * 1000
};
```

---

## Was wird überwacht?

### Pro Client (WebSocket-Verbindung)
- ✅ Einzelne Clients haben getrennte Limits
- ✅ Ein aggressiver Client blockiert andere nicht
- ✅ Wenn ein Client sich trennt, wird sein Limit gelöscht

### Was wird NICHT überwacht?
- ❌ Globale Server-Limits (nur pro-Client)
- ❌ Kompilation (nur Simulation-Starts)
- ❌ Andere API-Calls (nur `start_simulation`)

---

## Client-Fehler-Responses

### Wenn Rate-Limit überschritten

```
[ERR] Rate limit exceeded. Too many simulation starts. Please wait 30 seconds before starting again.
```

### Wo sieht das der Benutzer?

1. **Serial Monitor**: Fehler-Nachricht anzeigen
2. **Browser Console**: `[RateLimit] Simulation start rejected`
3. **Server Logs**: `[RateLimit] Simulation start rejected`

---

## Monitoring & Debug

### Rate Limiter Status abrufen

```typescript
const rateLimiter = getSimulationRateLimiter();
const stats = rateLimiter.getStats();

console.log(stats);
// Output:
// {
//   config: { maxRequests: 10, windowMs: 60000, blockDurationMs: 30000 },
//   activeClients: 5,
//   blockedClients: 1
// }
```

### Server Logs prüfen

```bash
# Mit Rate Limit Info
[2026-02-01T12:30:15.123Z][WARN][RateLimiter] Client blocked for 25s (too many simulation starts)
[2026-02-01T12:30:15.123Z][WARN][Routes] [RateLimit] Simulation start rejected. Retry after 25s
```

---

## Cleanup & Performance

### Automatischer Cleanup

- Alle **5 Minuten** werden inaktive Client-Einträge gelöscht
- Wenn WebSocket geschlossen → Client wird sofort entfernt
- Keine Anfragen in 10 Minuten → Eintrag wird gelöscht

### Memory-Footprint

- Pro Client: ~100 Bytes (WebSocket-Referenz + Metadaten)
- Mit 1000 Clients: ~100 KB
- Minimal impact auf Server-Speicher

---

## Best Practices

### Für Server-Betreiber

1. **Monitoring aktivieren**
   ```typescript
   setInterval(() => {
     const stats = getSimulationRateLimiter().getStats();
     console.log(`[Monitor] ${stats.blockedClients} clients rate-limited`);
   }, 60000);
   ```

2. **Limits an Hardware anpassen**
   - Schwache Server: Strengere Limits (5 Starts / 60s)
   - Starke Server: Lockere Limits (20 Starts / 60s)

3. **Logs überwachen**
   ```bash
   # Viele blockierte Clients → Limits zu streng?
   grep "blocked for" server.log | wc -l
   ```

### Für Entwickler

1. **In Tests deaktivieren**
   ```typescript
   // Mocke den Rate Limiter in Tests
   jest.mock("./services/rate-limiter", () => ({
     getSimulationRateLimiter: () => ({
       checkLimit: () => ({ allowed: true })
     })
   }));
   ```

2. **Client-seitiges Feedback**
   ```typescript
   // Benutzer warnen, bevor sie das Limit treffen
   if (simulationStartsInWindow > 8) {
     toast({ title: "Warning", message: "Approaching rate limit..." });
   }
   ```

---

## Sicherheit

### Was wird verhindert?

- ✅ **DoS-Attacken**: Ein Client kann nicht 1000x/sec starten
- ✅ **Ressourcen-Hunger**: Server kann sich nicht durch Simulation-Spam überlasten
- ✅ **Unfaire Nutzung**: Ein User blockiert nicht alle anderen

### Was wird NICHT verhindert?

- ❌ Verteilte Attacken (viele Clients mit unterschiedlichen IPs)
- ❌ Rate Limiting für HTTP-API (nur WebSocket)
- ❌ Globale Server-Limits (nur pro-Client)

---

## Fehlerbehebung

### "Simulation startet nicht mehr"
- Prüfe: Wurde der Rate Limit erreicht?
- Lösung: 30 Sekunden warten oder Browser-Tab neu laden

### "Zu viele blockierte Clients"
- Prüfe: Sind die Limits zu streng?
- Lösung: `maxRequests` erhöhen oder `windowMs` vergrößern

### "Rate Limiter funktioniert nicht"
- Prüfe Server Logs: `[RateLimiter]` Messages?
- Debug: `getSimulationRateLimiter().getStats()`
