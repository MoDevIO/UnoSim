/**
 * Test Suite for Arduino Compiler Line Number Correction
 * 
 * These tests verify that compiler error messages show correct line numbers
 * from the original code, even when headers are embedded.
 */

import { ArduinoCompiler } from '../../../server/services/arduino-compiler';
import { spawn } from 'child_process';
import { writeFile, mkdir, rm } from 'fs/promises';

jest.mock('child_process');
jest.mock('fs/promises');

describe('ArduinoCompiler - Line Number Correction', () => {
  let compiler: ArduinoCompiler;
  const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
  const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
  const mockRm = rm as jest.MockedFunction<typeof rm>;

  beforeEach(async () => {
    jest.clearAllMocks();
    compiler = await ArduinoCompiler.create();

    // Standard mocks
    mockWriteFile.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockRm.mockResolvedValue(undefined);
  });

  describe('Without Headers', () => {
    it('should report correct line number for error in simple code', async () => {
      const code = `void setup() {
  Serial.begin(115200);
}

void loop() {
  undefinedFunction(); // Line 6 - Error here
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // Simulate compiler error at line 6
              cb(Buffer.from('sketch.ino:6:3: error: use of undeclared identifier \'undefinedFunction\'\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('sketch.ino:6:');
      expect(result.errors).toContain('undefinedFunction');
    });

    it('should report correct line number for recursive function error', async () => {
      const code = `int r;

void setup()
{
  rek();
}
void loop()
{
}

void rek()
{
  r++;
  Serial.println(r);
  delay(100);
  if (r < 10)
  rek(); // This is line 17, but error should be at line 5 where rek() is called
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // Simulate compiler error at line 5 (rek() call in setup)
              cb(Buffer.from('sketch.ino:5:3: error: use of undeclared identifier \'rek\'\n  5 |   rek();\n      |   ^\n1 error generated.\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('sketch.ino:5:');
      expect(result.errors).toContain('rek');
    });
  });

  describe('With Single Header', () => {
    it('should correct line numbers when one header is embedded', async () => {
      const headerContent = `// Header file content
int myFunction() {
  return 42;
}
// End of header`;

      const code = `#include "myheader.h"

void setup() {
  Serial.begin(115200);
  undefinedFunction(); // This is line 5 in original code
}

void loop() {
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // After embedding header (5 lines of content + 2 lines of comments = 7 lines total)
              // Original line 5 becomes line 11 (5 + 6 offset)
              // Compiler reports line 11, should be corrected back to line 5
              cb(Buffer.from('sketch.ino:11:3: error: use of undeclared identifier \'undefinedFunction\'\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const headers = [{ name: 'myheader.h', content: headerContent }];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(false);
      // Should be corrected to line 5 (original line in user code)
      expect(result.errors).toContain('sketch.ino:5:');
      expect(result.errors).toContain('undefinedFunction');
    });

    it('should correct line numbers with multi-line header', async () => {
      const headerContent = `// Header with 10 lines
int func1() { return 1; }
int func2() { return 2; }
int func3() { return 3; }
int func4() { return 4; }
int func5() { return 5; }
int func6() { return 6; }
int func7() { return 7; }
int func8() { return 8; }
// End`;

      const code = `#include "header.h"

void setup() {
  unknownVar = 5; // Line 4 in original
}

void loop() {
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // Header has 10 lines, plus 2 comment lines = 12 total, 11 newlines
              // after embedding error at line 4 becomes line 15 (4 + 11)
              cb(Buffer.from('sketch.ino:15:3: error: use of undeclared identifier \'unknownVar\'\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const headers = [{ name: 'header.h', content: headerContent }];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(false);
      // Should be corrected to line 4
      expect(result.errors).toContain('sketch.ino:4:');
    });
  });

  describe('With Multiple Headers', () => {
    it('should correct line numbers when multiple headers are embedded', async () => {
      const header1 = `// Header 1
int h1func() { return 1; }`;

      const header2 = `// Header 2 - longer
int h2func1() { return 1; }
int h2func2() { return 2; }
int h2func3() { return 3; }`;

      const code = `#include "header1.h"
#include "header2.h"

void setup() {
  Serial.begin(115200);
}

void loop() {
  missingFunc(); // Line 9 in original code
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // header1: 2 lines content + 2 comment = 4 total, 3 newlines
              // header2: 4 lines content + 2 comment = 6 total, 5 newlines  
              // Total offset: 3 + 5 = 8 newlines
              // Line 9 in original becomes line 17 after embedding (9 + 8)
              cb(Buffer.from('sketch.ino:17:3: error: use of undeclared identifier \'missingFunc\'\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const headers = [
        { name: 'header1.h', content: header1 },
        { name: 'header2.h', content: header2 }
      ];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(false);
      // Should be corrected to line 9
      expect(result.errors).toContain('sketch.ino:9:');
    });

    it('should handle multiple errors with different line numbers', async () => {
      const headerContent = `// Header
int headerFunc() { return 0; }`;

      const code = `#include "myheader.h"

void setup() {
  error1(); // Line 4
  error2(); // Line 5
}

void loop() {
  error3(); // Line 9
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // Header: 2 lines content + 2 comment = 4 total, 3 newlines, offset = 3
              // Errors at lines 4, 5, 9 become lines 7, 8, 12 (original + 3)
              cb(Buffer.from(`sketch.ino:7:3: error: use of undeclared identifier 'error1'
sketch.ino:8:3: error: use of undeclared identifier 'error2'
sketch.ino:12:3: error: use of undeclared identifier 'error3'\n`));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const headers = [{ name: 'myheader.h', content: headerContent }];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('sketch.ino:4:');
      expect(result.errors).toContain('sketch.ino:5:');
      expect(result.errors).toContain('sketch.ino:9:');
    });
  });

  describe('Edge Cases', () => {
    it('should not produce negative line numbers', async () => {
      const headerContent = `// Very large header
${'int func() { return 0; }\n'.repeat(100)}`;

      const code = `#include "big.h"

void setup() {
}

void loop() {
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              // Error at line 1 (somehow)
              cb(Buffer.from('sketch.ino:1:1: error: some error\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const headers = [{ name: 'big.h', content: headerContent }];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(false);
      // Should not be negative, minimum is line 1
      expect(result.errors).toMatch(/sketch\.ino:[1-9]\d*:/);
      expect(result.errors).not.toMatch(/sketch\.ino:0:/);
      expect(result.errors).not.toMatch(/sketch\.ino:-/);
    });

    it('should preserve errors without line numbers', async () => {
      const code = `void setup() {
}

void loop() {
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') {
              cb(Buffer.from('error: general compilation error without line number\n'));
            }
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(1);
        }
      }));

      const result = await compiler.compile(code);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('general compilation error');
    });
  });

  describe('Success Cases', () => {
    it('should not affect line numbers in successful compilation', async () => {
      const headerContent = `int myFunc() { return 42; }`;

      const code = `#include "header.h"

void setup() {
  Serial.begin(115200);
  int x = myFunc();
}

void loop() {
}`;

      (spawn as jest.Mock).mockImplementationOnce(() => ({
        stdout: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from('Sketch uses 1024 bytes.\nGlobal variables use 32 bytes.\n'));
          }
        },
        stderr: {
          on: (event: string, cb: Function) => {
            if (event === 'data') cb(Buffer.from(''));
          }
        },
        on: (event: string, cb: Function) => {
          if (event === 'close') cb(0); // Success
        }
      }));

      const headers = [{ name: 'header.h', content: headerContent }];
      const result = await compiler.compile(code, headers);

      expect(result.success).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });
});
