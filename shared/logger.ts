/**
 * Policy-Konformes Zentrales Logging-System
 * 
 * Design-Entscheidungen:
 * 1. RING BUFFER für DEBUG-Logs (max. 200 Zeilen):
 *    - Hält Debug-Kontext im Speicher ohne Performance-Impact
 *    - Wird nur bei Prozess-Fehler oder fehlgeschlagenem Test geleert
 *    - Im Erfolgsfall bleibt Konsole sauber (hohe SNR)
 * 
 * 2. LOG-LEVELS mit Policy-Default (CI: WARN):
 *    - NONE: Keine Logs (für Tests, die absolut sauber sein müssen)
 *    - ERROR: Nur kritische Fehler
 *    - WARN: Warnings + Errors (CI Standard)
 *    - INFO: Allgemeine Informationen
 *    - DEBUG: Detaillierte Traceability (gepuffert)
 * 
 * 3. KONTEXT-KAPSELUNG:
 *    - Jede Logger-Instanz erfordert einen eindeutigen Kontexts-String
 *    - Ermöglicht volle Traceability und Fehlersuche (Policy-Kern)
 * 
 * 4. SANITIZATION (Sicherheitspolicy):
 *    - Automatische Maskierung: Tokens, Passwörter, API-Keys, PII
 *    - Reguläre Ausdrücke für gängige Patterns
 * 
 * 5. ASYNCHRONE ARCHITEKTUR:
 *    - Keine synchronen I/O-Blockaden
 *    - Ring-Buffer ist vollständig im RAM (O(1) Write)
 *    - Flush erfolgt nur beim Fehler asynchron
 */

export type LogLevel = "NONE" | "ERROR" | "WARN" | "INFO" | "DEBUG";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
}

class RingBuffer {
  private buffer: LogEntry[] = [];
  private maxSize: number = 200;
  private writeIndex: number = 0;

  /**
   * Ring-Buffer für O(1) Speicherung von Debug-Logs
   * Überlauf wird automatisch überschrieben (älteste Einträge)
   */
  push(entry: LogEntry): void {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(entry);
    } else {
      this.buffer[this.writeIndex] = entry;
    }
    this.writeIndex = (this.writeIndex + 1) % this.maxSize;
  }

  /**
   * Sortiert Buffer chronologisch und gibt alle Einträge aus
   */
  getAll(): LogEntry[] {
    if (this.buffer.length < this.maxSize) {
      return [...this.buffer];
    }
    // Buffer ist voll - reordnen nach write-Index
    return [
      ...this.buffer.slice(this.writeIndex),
      ...this.buffer.slice(0, this.writeIndex),
    ];
  }

  clear(): void {
    this.buffer = [];
    this.writeIndex = 0;
  }

  size(): number {
    return this.buffer.length;
  }
}

// ============ GLOBAL LOGGER STATE ============
let globalLogLevel: LogLevel = determineLogLevel();
const debugBuffer = new RingBuffer();

function determineLogLevel(): LogLevel {
  if (typeof process === "undefined") return "WARN";
  
  const env = process.env;
  const level = env.LOG_LEVEL || (env.NODE_ENV === "test" ? "WARN" : "INFO");
  
  if (!["NONE", "ERROR", "WARN", "INFO", "DEBUG"].includes(level)) {
    return "WARN";
  }
  return level as LogLevel;
}

function shouldLog(level: LogLevel): boolean {
  const levels: Record<LogLevel, number> = {
    NONE: 0,
    ERROR: 1,
    WARN: 2,
    INFO: 3,
    DEBUG: 4,
  };
  return levels[level] <= levels[globalLogLevel];
}

/**
 * SANITIZATION: Maskiert sensitive Daten in Log-Nachrichten
 * Patterns: Tokens, API-Keys, Passwörter, Cookies, SSN, Kreditkarten
 */
function sanitize(message: string): string {
  return message
    // Tokens und API-Keys (JWT, Bearer, API-Key Parameter)
    .replace(/bearer\s+[A-Za-z0-9-._~+/]+=*/gi, "bearer [REDACTED_TOKEN]")
    .replace(/(?:api[_-]?)?key[=:]\s*[A-Za-z0-9-._~+/]+=*/gi, "key=[REDACTED_KEY]")
    // Passwörter
    .replace(/password[=:]\s*[^\s,}\]"]*/gi, "password=[REDACTED]")
    .replace(/pwd[=:]\s*[^\s,}\]"]*/gi, "pwd=[REDACTED]")
    // Cookies
    .replace(/session[_-]?id[=:]\s*[A-Za-z0-9-._~+/]+=*/gi, "session_id=[REDACTED]")
    // Email-Adressen und Telefonnummern (PII)
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, "[EMAIL_REDACTED]")
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "[PHONE_REDACTED]")
    // SSN Pattern (XXX-XX-XXXX)
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, "[SSN_REDACTED]")
    // Kreditkartennummern
    .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[CARD_REDACTED]")
    // Allerdings: Spezifische sensitiv-Felder in JSON/Objekten
    .replace(/"(password|token|secret|apiKey|secret_key)"[^}]*:\s*"[^"]*"/gi, '$1:"[REDACTED]"');
}

/**
 * Flushes Debug-Buffer bei Fehler/Testfehlschlag
 * Wird von test-Setup und Error-Handler aufgerufen
 */
export function flushDebugOnFailure(reason?: string): void {
  if (debugBuffer.size() === 0) return;

  const entries = debugBuffer.getAll();
  if (entries.length === 0) return;

  console.error("\n" + "=".repeat(80));
  console.error("DEBUG BUFFER FLUSH (Test/Process Failure)");
  if (reason) console.error(`Reason: ${reason}`);
  console.error("=".repeat(80));

  entries.forEach((entry) => {
    console.error(
      `[${entry.timestamp}][${entry.level}][${entry.context}] ${entry.message}`
    );
  });

  console.error("=".repeat(80) + "\n");
  debugBuffer.clear();
}

// ============ LOGGER CLASS ============
export class Logger {
  private context: string;

  /**
   * Initialisiert Logger mit forciertem Kontext-String
   * Policy-Anforderung: Jede Instanz muss eindeutigen Kontext haben für Traceability
   */
  constructor(context: string) {
    if (!context || typeof context !== "string") {
      throw new Error(
        "Logger requires a mandatory context string for Policy compliance (Traceability)"
      );
    }
    this.context = context;
  }

  /**
   * Zentrale Log-Funktion mit Buffering-Logik
   */
  private log(level: LogLevel, message: string): void {
    // Früh-Return bei deaktiviertem Log-Level
    if (!shouldLog(level)) return;

    // Sanitize Nachrichten
    const sanitizedMessage = sanitize(String(message));
    const timestamp = new Date().toISOString();
    const fullMessage = `[${timestamp}][${level}][${this.context}] ${sanitizedMessage}`;

    const entry: LogEntry = {
      timestamp,
      level,
      context: this.context,
      message: sanitizedMessage,
    };

    // BUFFERING-STRATEGIE:
    // Debug-Logs gehen in Ring-Buffer (wird nur bei Fehler geflushert)
    if (level === "DEBUG") {
      debugBuffer.push(entry);
    } else {
      // Error, Warn, Info gehen sofort auf die Konsole (asynchron über console API)
      try {
        if (level === "ERROR") {
          console.error(fullMessage);
        } else {
          console.log(fullMessage);
        }
      } catch (err) {
        // Fehlertoleranz für geschlossene Streams
        if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
          console.error("Logger error:", err);
        }
      }
    }
  }

  error(message: string): void {
    this.log("ERROR", message);
  }

  warn(message: string): void {
    this.log("WARN", message);
  }

  info(message: string): void {
    this.log("INFO", message);
  }

  debug(message: string): void {
    this.log("DEBUG", message);
  }
}

// ============ GLOBALE FEHLERBEHANDLUNG ============
// Registriert globale Handler für Prozess-Fehler und Test-Fehlschlag
export function initializeGlobalErrorHandlers(): void {
  if (typeof process === "undefined") return;

  process.on("uncaughtException", (error: Error) => {
    // note: processError variable removed – we no longer track it separately
    flushDebugOnFailure(`Uncaught Exception: ${error.message}`);
  });

  process.on("unhandledRejection", (reason: any) => {
    flushDebugOnFailure(`Unhandled Rejection: ${String(reason)}`);
  });
}

/**
 * Manuell für Vitest-Integration aufrufen
 */
export function markTestAsFailed(testName?: string): void {
  // testsFailed flag removed; simply flush buffer immediately
  flushDebugOnFailure(testName ? `Test failed: ${testName}` : "Test failed");
}

export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function getLogLevel(): LogLevel {
  return globalLogLevel;
}
