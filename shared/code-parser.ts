import type { ParserMessage } from "./schema";
import { stripComments } from "@shared/parser-patterns";
import { SerialConfigurationParser } from "./parsers/serial-configuration-parser";
import { StructureParser } from "./parsers/structure-parser";
import { PerformanceParser } from "./parsers/performance-parser";
import { HardwareCompatibilityParser } from "./parsers/hardware-compatibility-parser";
import { PinConflictsParser } from "./parsers/pin-conflicts-parser";
import {
  analyzeStaticIO,
  type StaticIOAnalysis,
} from "./io-registry-parser";

type StaticIOAnalyzer = (code: string) => StaticIOAnalysis;

export class CodeParser {
  constructor(private readonly analyzeIO: StaticIOAnalyzer = analyzeStaticIO) {}

  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const parser = new SerialConfigurationParser(code);
    return parser.parse();
  }

  /**
   * Parse structure issues (setup/loop)
   */
  parseStructure(code: string): ParserMessage[] {
    const parser = new StructureParser(code);
    return parser.parse();
  }

  /**
   * Parse hardware compatibility issues
   */
  parseHardwareCompatibility(
    code: string,
    analysis: StaticIOAnalysis = this.analyzeIO(code),
  ): ParserMessage[] {
    const parser = new HardwareCompatibilityParser(analysis);
    return parser.parse();
  }

  /**
   * Parse pin conflicts (same pin used as digital and analog)
   */
  parsePinConflicts(
    code: string,
    analysis: StaticIOAnalysis = this.analyzeIO(code),
  ): ParserMessage[] {
    const parser = new PinConflictsParser(analysis);
    return parser.parse();
  }

  /**
   * Parse performance issues
   */
  parsePerformance(code: string): ParserMessage[] {
    const uncommentedCode = stripComments(code);
    const parser = new PerformanceParser(uncommentedCode, code);

    return [
      ...parser.analyzeComplexity(),
      ...parser.analyzeLargeArraysAndRecursion(),
    ];
  }

  /**
   * Parse all categories and combine results
   */
  parseAll(code: string): ParserMessage[] {
    const analysis = this.analyzeIO(code);
    return [
      ...this.parseSerialConfiguration(code),
      ...this.parseStructure(code),
      ...this.parseHardwareCompatibility(code, analysis),
      ...this.parsePinConflicts(code, analysis),
      ...this.parsePerformance(code),
    ];
  }

}
