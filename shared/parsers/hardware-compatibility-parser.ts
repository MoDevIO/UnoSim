import type { ParserMessage } from "../schema";
import { randomUUID } from "node:crypto";
import {
  type StaticIOAnalysis,
  type StaticIOCall,
  type StaticIOOperation,
  type UnresolvedStaticIOCall,
} from "@shared/io-registry-parser";

const PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);
const DIGITAL_OPERATIONS = new Set<StaticIOOperation>([
  "digitalRead",
  "digitalWrite",
]);
const LITERAL_PIN_EXPRESSION = /^(?:\d+|A\d+)$/;

function pinLabel(pinId: number): string {
  return pinId >= 14 ? `A${pinId - 14}` : String(pinId);
}

function resolvedCalls(
  analysis: StaticIOAnalysis,
  operation: StaticIOOperation,
): StaticIOCall[] {
  return analysis.pins
    .flatMap(({ calls }) => calls)
    .filter(({ op }) => op === operation)
    .sort((a, b) => a.line - b.line);
}

function digitalCalls(analysis: StaticIOAnalysis): StaticIOCall[] {
  return analysis.pins
    .flatMap(({ calls }) => calls)
    .filter(({ op }) => DIGITAL_OPERATIONS.has(op))
    .sort((a, b) => a.line - b.line);
}

function unresolvedDigitalCalls(
  analysis: StaticIOAnalysis,
): UnresolvedStaticIOCall[] {
  return analysis.unresolvedCalls.filter(({ op }) =>
    DIGITAL_OPERATIONS.has(op),
  );
}

function createLiteralMissingPinModeMessage(call: StaticIOCall): ParserMessage {
  const pin = call.sourceExpression;
  return {
    id: randomUUID(),
    type: "warning",
    category: "hardware",
    severity: 2,
    message: `Pin ${pin} used with digitalRead/digitalWrite but pinMode() was not called for this pin.`,
    suggestion: `pinMode(${pin}, INPUT);`,
    line: call.line,
  };
}

function createVariableMissingPinModeMessage(
  call: StaticIOCall | UnresolvedStaticIOCall,
): ParserMessage {
  const variable = call.sourceExpression;
  return {
    id: randomUUID(),
    type: "warning",
    category: "hardware",
    severity: 2,
    message: `Variable '${variable}' used in digitalRead/digitalWrite but no pinMode() call found for this variable.`,
    suggestion: `pinMode(${variable}, INPUT);`,
    line: call.line,
  };
}

/** Derives hardware compatibility messages from canonical static I/O facts. */
export class HardwareCompatibilityParser {
  constructor(private readonly analysis: StaticIOAnalysis) {}

  parse(): ParserMessage[] {
    return [
      ...this.checkAnalogWritePWM(),
      ...this.checkPinModeConflicts(),
      ...this.checkMissingPinModes(),
      ...this.checkOutputPinsReadAsInput(),
    ];
  }

  private checkAnalogWritePWM(): ParserMessage[] {
    return resolvedCalls(this.analysis, "analogWrite")
      .filter(({ pinId }) => !PWM_PINS.has(pinId))
      .map((call) => ({
        id: randomUUID(),
        type: "warning" as const,
        category: "hardware" as const,
        severity: 2 as const,
        message: `analogWrite(${call.sourceExpression}, ...) used on pin ${call.pinId}, which doesn't support PWM on Arduino UNO. PWM pins: 3, 5, 6, 9, 10, 11.`,
        suggestion: "// Use PWM pin instead: analogWrite(3, value);",
        line: call.line,
      }));
  }

  private checkPinModeConflicts(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    for (const { pinId, calls } of this.analysis.pins) {
      const pinModeCalls = calls.filter(({ op }) => op === "pinMode");
      if (pinModeCalls.length < 2) continue;

      const modes = pinModeCalls.flatMap(({ mode }) => mode ?? []);
      const uniqueModes = [...new Set(modes)];
      const firstExpression = pinModeCalls[0]?.sourceExpression;
      const pin =
        firstExpression && LITERAL_PIN_EXPRESSION.test(firstExpression)
          ? firstExpression
          : pinLabel(pinId);
      const line = pinModeCalls[1]?.line;

      if (uniqueModes.length > 1) {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "pins",
          severity: 2,
          message: `Pin ${pin} has multiple pinMode() calls with different modes: ${uniqueModes.join(", ")}.`,
          suggestion: `Use a single pinMode(${pin}, <MODE>) call in setup().`,
          line,
        });
      } else {
        messages.push({
          id: randomUUID(),
          type: "warning",
          category: "pins",
          severity: 2,
          message: `Pin ${pin} has pinMode() called multiple times (${pinModeCalls.length}x).`,
          suggestion: `Remove duplicate pinMode(${pin}, ${uniqueModes[0]}) calls.`,
          line,
        });
      }
    }
    return messages;
  }

  private checkMissingPinModes(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    const configuredPins = new Set(
      this.analysis.pins
        .filter(({ calls }) => calls.some(({ op }) => op === "pinMode"))
        .map(({ pinId }) => pinId),
    );
    const configuredExpressions = new Set(
      this.analysis.unresolvedCalls
        .filter(({ op }) => op === "pinMode")
        .map(({ sourceExpression }) => sourceExpression),
    );
    const warnedLiterals = new Set<string>();
    let warnedVariable = false;

    for (const call of digitalCalls(this.analysis)) {
      if (configuredPins.has(call.pinId)) continue;
      if (LITERAL_PIN_EXPRESSION.test(call.sourceExpression)) {
        if (warnedLiterals.has(call.sourceExpression)) continue;
        warnedLiterals.add(call.sourceExpression);
        messages.push(createLiteralMissingPinModeMessage(call));
      } else if (!warnedVariable) {
        messages.push(createVariableMissingPinModeMessage(call));
        warnedVariable = true;
      }
    }

    for (const call of unresolvedDigitalCalls(this.analysis)) {
      if (warnedVariable || configuredExpressions.has(call.sourceExpression)) {
        continue;
      }
      messages.push(createVariableMissingPinModeMessage(call));
      warnedVariable = true;
    }

    return messages;
  }

  private checkOutputPinsReadAsInput(): ParserMessage[] {
    const messages: ParserMessage[] = [];
    for (const { pinId, calls } of this.analysis.pins) {
      const isOutput = calls.some(
        ({ op, mode }) => op === "pinMode" && mode === "OUTPUT",
      );
      const readCall = calls.find(({ op }) => op === "digitalRead");
      if (!isOutput || !readCall) continue;

      const pin = pinLabel(pinId);
      messages.push({
        id: randomUUID(),
        type: "warning",
        category: "pins",
        severity: 2,
        message: `Pin ${pin} is configured as OUTPUT but read with digitalRead(). Reading an OUTPUT pin may return unexpected values.`,
        suggestion: `If you need to read the pin, use pinMode(${pin}, INPUT) or INPUT_PULLUP instead.`,
        line: readCall.line,
      });
    }
    return messages;
  }
}
