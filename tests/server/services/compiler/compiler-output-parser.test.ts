import { describe, it, expect } from "vitest";
import { CompilerOutputParser } from "../../../../server/services/compiler/compiler-output-parser";

describe("CompilerOutputParser", () => {
  describe("parseErrors", () => {
    it("should parse single error with file:line:column format", () => {
      const stderr = "sketch.cpp:15:3: error: 'Serial' was not declared in this scope";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        file: "sketch.cpp",
        line: 15,
        column: 3,
        type: "error",
        message: "'Serial' was not declared in this scope",
      });
    });

    it("should parse multiple errors", () => {
      const stderr =
        "sketch.cpp:15:3: error: 'Serial' was not declared\n" +
        "sketch.cpp:20:1: warning: unused variable 'x'";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(2);
      expect(errors[0].type).toBe("error");
      expect(errors[1].type).toBe("warning");
    });

    it("should parse error without column number", () => {
      const stderr = "sketch.cpp:15: error: compilation failed";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(1);
      expect(errors[0]).toEqual({
        file: "sketch.cpp",
        line: 15,
        column: 0,
        type: "error",
        message: "compilation failed",
      });
    });

    it("should extract basename from full file paths", () => {
      const stderr = "/builds/sketch/build/sketch.cpp:10:5: error: syntax error";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors[0].file).toBe("sketch.cpp");
    });

    it("should apply line offset to adjust line numbers", () => {
      const stderr = "sketch.cpp:20:0: error: test error";
      const errors = CompilerOutputParser.parseErrors(stderr, 5);

      expect(errors[0].line).toBe(15); // 20 - 5 = 15
    });

    it("should enforce minimum line number of 1 after offset", () => {
      const stderr = "sketch.cpp:2:0: error: test error";
      const errors = CompilerOutputParser.parseErrors(stderr, 5);

      expect(errors[0].line).toBe(1); // Math.max(1, 2 - 5) = 1
    });

    it("should deduplicate identical errors", () => {
      const stderr =
        "sketch.cpp:15:3: error: duplicate error\n" +
        "sketch.cpp:15:3: error: duplicate error";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(1);
    });

    it("should handle fallback generic parsing when regex doesn't match", () => {
      const stderr = "Some unmatched error output\nAnother error line";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(2);
      expect(errors[0]).toEqual({
        file: "",
        line: 0,
        column: 0,
        type: "error",
        message: "Some unmatched error output",
      });
      expect(errors[1]).toEqual({
        file: "",
        line: 0,
        column: 0,
        type: "error",
        message: "Another error line",
      });
    });

    it("should return empty array for empty stderr", () => {
      const errors = CompilerOutputParser.parseErrors("");

      expect(errors).toEqual([]);
    });

    it("should ignore whitespace-only lines in fallback parsing", () => {
      const stderr = "error line\n  \n  \nanother error";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors).toHaveLength(2);
    });

    it("should handle multiline error messages", () => {
      const stderr =
        "sketch.cpp:15:3: error: 'Serial' was not declared in this scope\n" +
        "    Serial.println(test);\n" +
        "    ^";
      const errors = CompilerOutputParser.parseErrors(stderr);

      // Only the first error line should be parsed
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toBe("'Serial' was not declared in this scope");
    });

    it("should preserve error message with special characters", () => {
      const stderr = "sketch.cpp:10:5: error: undefined reference to 'foo()'";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors[0].message).toBe("undefined reference to 'foo()'");
    });

    it("should handle both error and warning types", () => {
      const stderr =
        "sketch.cpp:5:0: warning: unused variable 'count'\n" +
        "sketch.cpp:10:0: error: 'x' was not declared";
      const errors = CompilerOutputParser.parseErrors(stderr);

      expect(errors[0].type).toBe("warning");
      expect(errors[1].type).toBe("error");
    });
  });
});
