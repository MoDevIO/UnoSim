import type { ParserMessage } from "./schema";
import { randomUUID } from "node:crypto";

type SeverityLevel = 1 | 2 | 3;

/**
 * Reserved names that conflict with standard C/C++ and Arduino libraries
 * These names cannot be used as variable/function names in Arduino sketches
 */
const RESERVED_STANDARD_NAMES = new Set([
  // POSIX functions (unistd.h, stdlib.h, etc.)
  "pause",
  "system",
  "abort",
  "exit",
  "signal",
  "fork",
  "exec",
  "execv",
  "execve",
  "execvp",
  "wait",
  "waitpid",
  "pipe",
  "dup",
  "dup2",
  "close",
  "read",
  "write",
  "open",
  "chmod",
  "chown",
  "getpid",
  "getppid",
  "getuid",
  "setuid",
  "getenv",
  "setenv",
  "putenv",
  "sleep",
  "usleep",
  "alarm",
  "time",
  "clock",
  "ctime",
  "localtime",
  "gmtime",
  "mktime",
  "strftime",
  "mkfifo",
  "rename",
  "remove",
  "mkdir",
  "rmdir",
  "getcwd",
  "chdir",
  "unlink",
  "truncate",
  "stat",
  "fstat",
  "lstat",
  "access",
  "link",
  "symlink",
  "readlink",
  "ftok",
  "getuid",
  "getgid",
  "getgroups",
  "setgroups",
  "setgid",
  "getlogin",
  "getpgrp",
  "setpgrp",
  "getpgid",
  "setpgid",
  "setsid",
  "tcgetpgrp",
  "tcsetpgrp",
  "ioctl",
  "fcntl",
  "flock",

  // stdio.h functions
  "printf",
  "fprintf",
  "sprintf",
  "snprintf",
  "scanf",
  "fscanf",
  "sscanf",
  "getchar",
  "putchar",
  "gets",
  "puts",
  "fopen",
  "freopen",
  "fclose",
  "fflush",
  "fgetc",
  "fputc",
  "fgets",
  "fputs",
  "fread",
  "fwrite",
  "fseek",
  "ftell",
  "rewind",
  "clearerr",
  "feof",
  "ferror",
  "perror",

  // stdlib.h functions
  "malloc",
  "calloc",
  "realloc",
  "free",
  "alloca",
  "atoi",
  "atol",
  "atof",
  "strtol",
  "strtoul",
  "strtof",
  "strtod",
  "rand",
  "srand",
  "qsort",
  "bsearch",

  // string.h functions
  "strlen",
  "strcpy",
  "strncpy",
  "strcat",
  "strncat",
  "strcmp",
  "strncmp",
  "strchr",
  "strrchr",
  "strstr",
  "memcpy",
  "memmove",
  "memset",
  "memchr",
  "memcmp",
  "strtok",

  // Arduino-specific conflicting names
  "setup",
  "loop",
  "Serial",
  "pinMode",
  "digitalWrite",
  "digitalRead",
  "analogWrite",
  "analogRead",
  "attachInterrupt",
  "detachInterrupt",
  "millis",
  "micros",
  "delay",
  "delayMicroseconds",
  "micros",
  "delayMicroseconds",

  // Common macros/constants
  "NULL",
  "EOF",
  "TRUE",
  "FALSE",
]);

class ReservedNamesValidator {
  /**
   * Validate Arduino code for reserved name conflicts
   */
  validateReservedNames(code: string): ParserMessage[] {
    const messages: ParserMessage[] = [];

    // Remove comments to check only active code
    const uncommentedCode = this.removeComments(code);

    // Check for variable declarations using reserved names
    // Match patterns like: int pause; float pause; int* pause; etc.
    const varDeclRegex =
      /\b(int|float|double|bool|byte|char|short|long|unsigned|const|volatile|static)\s+(?:\*+\s*)*(\w+)\s*(?:[=;])/g;

    let match;
    const foundReservedNames = new Set<string>();

    while ((match = varDeclRegex.exec(uncommentedCode)) !== null) {
      const varName = match[2];
      if (RESERVED_STANDARD_NAMES.has(varName) && !foundReservedNames.has(varName)) {
        foundReservedNames.add(varName);

        const lineNum = this.findLineNumber(uncommentedCode, varName, match.index);

        messages.push({
          id: randomUUID(),
          type: "error",
          category: "reserved-name",
          severity: 3 as SeverityLevel,
          message: `Variable name "${varName}" conflicts with a standard library function and cannot be used.`,
          suggestion: `Rename the variable to something else (e.g., "${varName}Flag", "${varName}Value")`,
          line: lineNum,
        });
      }
    }

    // Also check for function definitions using reserved names
    const funcDeclRegex =
      /\b(?:int|float|double|bool|byte|char|short|long|unsigned|void)\s+(\w+)\s*\(/g;

    while ((match = funcDeclRegex.exec(uncommentedCode)) !== null) {
      const funcName = match[1];
      // Only warn about function names that are inside user code (not Arduino functions)
      if (
        RESERVED_STANDARD_NAMES.has(funcName) &&
        !["setup", "loop"].includes(funcName) &&
        !foundReservedNames.has(funcName)
      ) {
        foundReservedNames.add(funcName);

        const lineNum = this.findLineNumber(uncommentedCode, funcName, match.index);

        messages.push({
          id: randomUUID(),
          type: "error",
          category: "reserved-name",
          severity: 3 as SeverityLevel,
          message: `Function name "${funcName}" conflicts with a standard library function and cannot be used.`,
          suggestion: `Rename the function to something else (e.g., "${funcName}Custom", "${funcName}Handler")`,
          line: lineNum,
        });
      }
    }

    return messages;
  }

  /**
   * Remove C++ style comments from code
   */
  private removeComments(code: string): string {
    let result = "";
    let i = 0;

    while (i < code.length) {
      // Check for line comment //
      if (code[i] === "/" && code[i + 1] === "/") {
        const { newI, addNewline } = _skipLineComment(code, i);
        i = newI;
        if (addNewline) result += "\n";
      }
      // Check for block comment /* */
      else if (code[i] === "/" && code[i + 1] === "*") {
        const { newI, preserved } = _skipBlockComment(code, i);
        i = newI;
        result += preserved;
      } else {
        result += code[i];
        i++;
      }
    }

    return result;
  }

  /**
   * Find the line number where a name occurs
   */
  private findLineNumber(
    code: string,
    name: string,
    startIndex?: number,
  ): number {
    const searchCode = startIndex === undefined ? code.slice(0, Math.max(0, code.indexOf(name) + name.length)) : code.slice(0, Math.max(0, startIndex + name.length));
    return (searchCode.match(/\n/g) || []).length + 1;
  }
}

/** Skip a C++ // line comment; returns new position and whether a newline was consumed. */
function _skipLineComment(code: string, i: number): { newI: number; addNewline: boolean } {
  let j = i;
  while (j < code.length && code[j] !== "\n") {
    j++;
  }
  if (j < code.length) {
    return { newI: j + 1, addNewline: true }; // consume newline, preserve in output
  }
  return { newI: j, addNewline: false };
}

/** Skip a C-style block comment /* ... *\/; returns new position and preserved newlines. */
function _skipBlockComment(code: string, start: number): { newI: number; preserved: string } {
  let i = start + 2;
  let preserved = "";
  while (i < code.length - 1) {
    if (code[i] === "*" && code[i + 1] === "/") {
      return { newI: i + 2, preserved };
    }
    if (code[i] === "\n") {
      preserved += "\n"; // Preserve newlines to keep line numbers correct
    }
    i++;
  }
  return { newI: i, preserved };
}

export const reservedNamesValidator = new ReservedNamesValidator();
