# Data Communication Audit Report

**Datum:** 2025-01-22  
**Scope:** Top-Down Analyse der WebSocket-Kommunikation und Schema-Definitionen

---

## 1. Schema-Analyse (serial_event Payload Deadwood)

### 🔴 Ungenutzte Felder im serial_event Payload

Die folgenden Felder sind in `shared/schema.ts` definiert, werden aber **weder produziert noch konsumiert**:

| Feld | Schema-Zeile | Produziert | Konsumiert | Empfehlung |
|------|--------------|------------|------------|------------|
| `bits_per_frame` | L47 | ❌ Nirgends | ❌ Nirgends | **LÖSCHEN** |
| `txBufferBefore` | L48 | ❌ Nirgends | ❌ Nirgends | **LÖSCHEN** |
| `txBufferCapacity` | L49 | ❌ Nirgends | ❌ Nirgends | **LÖSCHEN** |

### 🟡 Optional genutzte Felder

| Feld | Produziert | Konsumiert | Status |
|------|------------|------------|--------|
| `ts_write` | ✅ C++ Mock → sandbox-runner | ✅ arduino-simulator.tsx L2212-2217 | **BEHALTEN** (Sortierung) |
| `data` | ✅ C++ Mock → sandbox-runner | ✅ arduino-simulator.tsx L2224 | **BEHALTEN** (Kerndaten) |
| `baud` | ✅ C++ Mock (optional) | ❌ Frontend ignoriert | ⚠️ Prüfen |
| `blocking` | ✅ C++ Mock (optional) | ❌ Frontend ignoriert | ⚠️ Prüfen |
| `atomic` | ✅ C++ Mock (optional) | ❌ Frontend ignoriert | ⚠️ Prüfen |
| `type` | ✅ Immer vorhanden | ❌ Frontend ignoriert | ⚠️ Prüfen |

---

## 2. WebSocket Event Audit

### Message Types im Schema (wsMessageSchema)

| Message Type | Server sendet | Client handhabt | Client sendet | Server handhabt | Status |
|--------------|---------------|-----------------|---------------|-----------------|--------|
| `serial_output` | ✅ routes.ts L246,312,319,328,349,467 | ✅ arduino-simulator.tsx L1593 | ❌ | - | ✅ OK |
| `serial_input` | ❌ | - | ✅ L2768 | ✅ routes.ts L545 | ✅ OK |
| `serial_event` | ✅ routes.ts L306 | ✅ arduino-simulator.tsx L1686 | ❌ | - | ✅ OK |
| `start_simulation` | ❌ | - | ✅ | ✅ routes.ts L237 | ✅ OK |
| `pause_simulation` | ❌ | - | ✅ | ✅ routes.ts L497 | ✅ OK |
| `resume_simulation` | ❌ | - | ✅ | ✅ routes.ts L517 | ✅ OK |
| `stop_simulation` | ❌ | - | ✅ | ✅ routes.ts L478 | ✅ OK |
| `code_changed` | ❌ | - | ✅ L1980 | ✅ routes.ts L453 | ✅ OK |
| `compilation_error` | ✅ routes.ts L367 | ✅ arduino-simulator.tsx ~L1720 | ❌ | - | ✅ OK |
| `compilation_status` | ✅ routes.ts L268,289,344,372,392 | ✅ arduino-simulator.tsx L1693 | ❌ | - | ✅ OK |
| `simulation_status` | ✅ routes.ts L224,262,354,377,463 | ✅ arduino-simulator.tsx ~L1730 | ❌ | - | ✅ OK |
| `pin_state` | ✅ routes.ts L404 | ✅ arduino-simulator.tsx ~L1745 | ❌ | - | ✅ OK |
| `set_pin_value` | ❌ | - | ✅ L2573,2604 | ✅ routes.ts L562 | ✅ OK |
| `parser_messages` | ❌ **NIE über WS** | ❌ Nie | ❌ | ❌ | 🔴 **DEADWOOD** |
| `io_registry` | ✅ routes.ts L417 | ✅ arduino-simulator.tsx ~L1760 | ❌ | - | ✅ OK |

### 🔴 Kritischer Fund: `parser_messages` Message Type

**Befund:** Der Message Type `parser_messages` ist im `wsMessageSchema` definiert (L98-120), wird aber:
- **Nie über WebSocket gesendet** - parserMessages werden via HTTP Response (`CompilationResult`) übertragen
- **Nie über WebSocket empfangen** - kein `case "parser_messages":` im Frontend switch

**Empfehlung:** Aus `wsMessageSchema` entfernen, da es ein HTTP-Feature ist.

---

## 3. Payload-Verschlankung

### serial_event Payload - Aktuelle Struktur (schema.ts L40-52)

```typescript
payload: z.object({
  type: z.string(),              // ⚠️ Nie gelesen
  ts_write: z.number(),          // ✅ Wird für Sortierung genutzt
  data: z.string(),              // ✅ Kerndaten
  baud: z.number().optional(),   // ⚠️ Nie gelesen
  bits_per_frame: z.number().optional(),   // 🔴 DEADWOOD
  txBufferBefore: z.number().optional(),   // 🔴 DEADWOOD
  txBufferCapacity: z.number().optional(), // 🔴 DEADWOOD
  blocking: z.boolean().optional(),        // ⚠️ Nie gelesen
  atomic: z.boolean().optional(),          // ⚠️ Nie gelesen
}),
```

### Empfohlene minimale Struktur

```typescript
payload: z.object({
  ts_write: z.number(),
  data: z.string(),
}),
```

---

## 4. Zusammenfassung der Empfehlungen

### Sofort löschbar (Deadwood)

| Datei | Änderung | Begründung |
|-------|----------|------------|
| `shared/schema.ts` | Entferne `parser_messages` aus wsMessageSchema | Nie über WS gesendet/empfangen |
| `shared/schema.ts` | Entferne `bits_per_frame` aus serial_event payload | Nie produziert/konsumiert |
| `shared/schema.ts` | Entferne `txBufferBefore` aus serial_event payload | Nie produziert/konsumiert |
| `shared/schema.ts` | Entferne `txBufferCapacity` aus serial_event payload | Nie produziert/konsumiert |

### Zu überprüfen (potentielles Deadwood)

| Feld | Begründung |
|------|------------|
| `payload.type` | Wird im C++ Mock gesetzt, aber im Frontend nie gelesen |
| `payload.baud` | Wird im C++ Mock gesetzt, aber im Frontend nie gelesen |
| `payload.blocking` | Wird im C++ Mock gesetzt, aber im Frontend nie gelesen |
| `payload.atomic` | Wird im C++ Mock gesetzt, aber im Frontend nie gelesen |

**Hinweis:** Diese Felder könnten für zukünftige Features geplant sein. Vor dem Löschen sollte geprüft werden, ob sie in der Roadmap stehen.

---

## 5. Cleanup-Befehle

### Schema bereinigen (sichere Änderungen)

Nach Bestätigung können folgende Änderungen in `shared/schema.ts` durchgeführt werden:

1. **Zeilen 47-49 löschen** (bits_per_frame, txBufferBefore, txBufferCapacity)
2. **Zeilen 98-120 löschen** (parser_messages Message Type)

### Geschätzte Einsparung

- **~25 Zeilen** Schema-Code
- **Sauberere API-Dokumentation**
- **Kleinere WebSocket-Payloads** (nach C++ Mock-Anpassung)
