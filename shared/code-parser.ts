import type { ParserMessage } from "./schema";
import { stripComments } from "@shared/parser-patterns";
import { SerialConfigurationParser } from "./parsers/serial-configuration-parser";
import { StructureParser } from "./parsers/structure-parser";
import { PerformanceParser } from "./parsers/performance-parser";
import { HardwareCompatibilityParser } from "./parsers/hardware-compatibility-parser";
import { PinConflictsParser } from "./parsers/pin-conflicts-parser";
import {
  analyzeStaticIO,
  analyzeStaticIOProject,
  type StaticIOAnalysis,
  type StaticIOOptions,
  type StaticIOProjectAnalysis,
} from "./io-registry-parser";
import type { SourceProject } from "./source-project";
import { type BoardId, DEFAULT_BOARD_ID } from "./boards";

type StaticIOAnalyzer = (code: string, options?: StaticIOOptions) => StaticIOAnalysis;
type StaticIOProjectAnalyzer = (project: SourceProject, options?: StaticIOOptions) => StaticIOProjectAnalysis;

export class CodeParser {
  constructor(
    private readonly analyzeIO: StaticIOAnalyzer = analyzeStaticIO,
    private readonly analyzeIOProject: StaticIOProjectAnalyzer = analyzeStaticIOProject,
    /** Board the sketch is parsed for: its pins, names and rules (plan P4.2). */
    readonly board: BoardId = DEFAULT_BOARD_ID,
  ) {}

  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const parser = new SerialConfigurationParser(code, this.board);
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
    analysis: StaticIOAnalysis = this.analyzeIO(code, { board: this.board }),
  ): ParserMessage[] {
    const parser = new HardwareCompatibilityParser(analysis, this.board, code);
    return parser.parse();
  }

  /**
   * Parse pin conflicts (same pin used as digital and analog)
   */
  parsePinConflicts(
    code: string,
    analysis: StaticIOAnalysis = this.analyzeIO(code, { board: this.board }),
  ): ParserMessage[] {
    const parser = new PinConflictsParser(analysis, this.board);
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
    const analysis = this.analyzeIO(code, { board: this.board });
    return [
      ...this.parseSerialConfiguration(code),
      ...this.parseStructure(code),
      ...this.parseHardwareCompatibility(code, analysis),
      ...this.parsePinConflicts(code, analysis),
      ...this.parsePerformance(code),
    ];
  }

  /**
   * Parse a project using one include-resolved static I/O analysis. Structure,
   * serial, and performance checks intentionally remain entry-file scoped.
   */
  parseAllProject(project: SourceProject): ParserMessage[] {
    const entryCode = project.files[project.entryFile] ?? "";
    const analysis = this.analyzeIOProject(project, { board: this.board });
    return [
      ...this.parseSerialConfiguration(entryCode),
      ...this.parseStructure(entryCode),
      ...this.parseHardwareCompatibility(entryCode, analysis),
      ...this.parsePinConflicts(entryCode, analysis),
      ...this.parsePerformance(entryCode),
    ];
  }

}
