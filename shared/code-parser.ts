import type { ParserMessage } from "./schema";
import { removeComments } from "@shared/parser-patterns";
import { SerialConfigurationParser } from "./parsers/serial-configuration-parser";
import { StructureParser } from "./parsers/structure-parser";
import { PerformanceParser } from "./parsers/performance-parser";
import { HardwareCompatibilityParser } from "./parsers/hardware-compatibility-parser";
import { PinConflictsParser } from "./parsers/pin-conflicts-parser";

export class CodeParser {
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
  parseHardwareCompatibility(code: string): ParserMessage[] {
    const parser = new HardwareCompatibilityParser(code);
    return parser.parse();
  }

  /**
   * Parse pin conflicts (same pin used as digital and analog)
   */
  parsePinConflicts(code: string): ParserMessage[] {
    const parser = new PinConflictsParser(code);
    return parser.parse();
  }

  /**
   * Parse performance issues
   */
  parsePerformance(code: string): ParserMessage[] {
    const uncommentedCode = removeComments(code);
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
    return [
      ...this.parseSerialConfiguration(code),
      ...this.parseStructure(code),
      ...this.parseHardwareCompatibility(code),
      ...this.parsePinConflicts(code),
      ...this.parsePerformance(code),
    ];
  }

}
