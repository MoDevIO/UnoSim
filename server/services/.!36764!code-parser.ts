import { randomUUID } from 'crypto';
import type { ParserMessage } from '@shared/schema';

type SeverityLevel = 1 | 2 | 3;

export class CodeParser {
  /**
   * Parse Serial configuration issues
   */
  parseSerialConfiguration(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Remove comments to check active code
    const uncommentedCode = this.removeComments(code);

    // Check if Serial.begin exists at all
    const serialBeginExists = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(code);
    const serialBeginActive = /Serial\s*\.\s*begin\s*\(\s*\d+\s*\)/.test(uncommentedCode);

    if (!serialBeginActive) {
      if (serialBeginExists) {
        // Serial.begin exists but is commented out
        messages.push({
          id: randomUUID(),
          type: 'warning',
          category: 'serial',
          severity: 2 as SeverityLevel,
