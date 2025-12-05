import type { Express } from "express";
import type { CompilationResult } from './services/arduino-compiler';

import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { compiler } from "./services/arduino-compiler";
import { arduinoRunner } from "./services/arduino-runner";
import { insertSketchSchema, wsMessageSchema, type WSMessage } from "@shared/schema";

import { Logger } from "@shared/logger"; // Pfad ggf. anpassen


export async function registerRoutes(app: Express): Promise<Server> {
  const logger = new Logger("Routes");
  const httpServer = createServer(app);

  // Setup WebSocket server
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  let lastCompiledCode: string | null = null;
  const getRunningStatus = () => runnerProcess?.isRunning === true;

  function broadcastMessage(message: WSMessage) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  // Serial execution process handling
  let runnerProcess: typeof arduinoRunner | null = null;

  // --- Sketch CRUD routes (leicht gekürzt) ---
  app.get('/api/sketches', async (_req, res) => {
    try {
      const sketches = await storage.getAllSketches();
      res.json(sketches);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sketches' });
    }
  });

  app.get('/api/sketches/:id', async (req, res) => {
    try {
      const sketch = await storage.getSketch(req.params.id);
      if (!sketch) return res.status(404).json({ error: 'Sketch not found' });
      res.json(sketch);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch sketch' });
    }
  });

  app.post('/api/sketches', async (req, res) => {
    try {
      const validatedData = insertSketchSchema.parse(req.body);
      const sketch = await storage.createSketch(validatedData);
      res.status(201).json(sketch);
    } catch (error) {
      res.status(400).json({ error: 'Invalid sketch data' });
    }
  });

  app.put('/api/sketches/:id', async (req, res) => {
    try {
      const validatedData = insertSketchSchema.partial().parse(req.body);
      const sketch = await storage.updateSketch(req.params.id, validatedData);
      if (!sketch) return res.status(404).json({ error: 'Sketch not found' });
      res.json(sketch);
    } catch (error) {
      res.status(400).json({ error: 'Invalid sketch data' });
    }
  });

  app.delete('/api/sketches/:id', async (req, res) => {
    try {
      const deleted = await storage.deleteSketch(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Sketch not found' });
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete sketch' });
    }
  });

  // --- COMPILATION ---
  app.post('/api/compile', async (req, res) => {
    try {
      const { code, headers } = req.body;
      if (!code || typeof code !== 'string') {
        return res.status(400).json({ error: 'Code is required' });
      }

      console.log('[COMPILE] Received headers:', headers ? `${headers.length} files` : 'none');
      const result: CompilationResult = await compiler.compile(code, headers);

      if (result.success) {
        // Store the processed code (with embedded headers) for simulation
        lastCompiledCode = result.processedCode || code;
      }

      // WebSocket: Nur Status senden (KEIN output/errors)
      broadcastMessage({
        type: 'compilation_status',
        arduinoCliStatus: result.arduinoCliStatus,
        gccStatus: result.gccStatus,
      });

      // HTTP Response: Komplettes Ergebnis
      res.json(result);

    } catch (error) {
      broadcastMessage({
        type: 'compilation_status',
        arduinoCliStatus: 'error',
        gccStatus: 'error',
      });
      res.status(500).json({ error: 'Compilation failed' });
    }
  });

  // Updated start-simulation route
  app.post('/api/start-simulation', async (_req, res) => {
    if (!lastCompiledCode) {
      return res.status(400).json({ error: 'No compiled code available. Please compile first.' });
    }

    // Stop any current simulation
    if (runnerProcess) runnerProcess.stop();

    // Start genuine C++ execution with isComplete support!
    runnerProcess = arduinoRunner;
    runnerProcess.runSketch(
      lastCompiledCode,
      (line: string, isComplete?: boolean) => {
        // UPDATED: Send isComplete flag to frontend
        broadcastMessage({
          type: 'serial_output',
          data: line,
          isComplete: isComplete ?? true // Default to true for backwards compatibility
        });
      },
      (err: string) => {
        logger.warn(`[to WS][ERR]: ${err}`);
        broadcastMessage({ type: 'serial_output', data: '[ERR] ' + err });
      },
      (_code: number | null) => {
        setTimeout(() => {
          try {
            broadcastMessage({
              type: 'serial_output',
              data: '--- Simulation beendet: Loop-Durchläufe abgeschlossen ---\n',
              isComplete: true
            });
            broadcastMessage({ type: 'simulation_status', status: 'stopped' });
          } catch (err) {
            logger.error(`Fehler beim Senden der Stop-Nachricht: ${err instanceof Error ? err.message : String(err)}`);
          }
        }, 100);
      }
    );
    broadcastMessage({
      type: 'simulation_status',
      status: 'running',
    });
    res.json({ success: true });
  });

  app.post('/api/stop-simulation', async (_req, res) => {
    if (runnerProcess) runnerProcess.stop();
    broadcastMessage({
      type: 'simulation_status',
      status: 'stopped',
    });
    broadcastMessage({
      type: 'serial_output',
      data: 'Simulation stopped\n',
    });
    res.json({ success: true });
  });

  // --- WebSocket Connection Handler (nur einmal) ---
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({
      type: 'simulation_status',
      status: getRunningStatus() ? 'running' : 'stopped'
    }));

    ws.on('message', async (message) => {
      try {
        const data: WSMessage = wsMessageSchema.parse(JSON.parse(message.toString()));

        switch (data.type) {
          case 'serial_input':
            if (getRunningStatus()) {
              arduinoRunner.sendSerialInput(data.data);
              /*
              broadcastMessage({
                type: 'serial_output',
                data: `> ${data.data}\n`,
              });
              */
            } else {
              logger.warn('Serial input received but simulation is not running.');
            };
            break;

          // Hier können weitere Nachrichten-Typen behandelt werden, z.B.:
          // case 'some_other_type':
          //   // handle other message
          //   break;

          default:
            logger.warn(`Unbekannter WebSocket Nachrichtentyp: ${data.type}`);
            break;
        }
      } catch (error) {
        logger.error(`Invalid WebSocket message: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  });

  return httpServer;
}