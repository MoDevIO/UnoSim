import { CodeParser } from '../../../shared/code-parser';
import { ParserMessage } from '../../../shared/schema';

describe('CodeParser', () => {
  let parser: CodeParser;

  beforeEach(() => {
    parser = new CodeParser();
  });

  describe('parseSerialConfiguration', () => {
    it('should detect missing Serial.begin()', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          Serial.print("test");
          digitalWrite(13, HIGH);
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringContaining('Serial.begin'),
        })
      );
    });

    it('should detect wrong baudrate (not 115200)', () => {
      const code = `
        void setup() {
          Serial.begin(9600);
        }
        void loop() {
          Serial.println("Test");
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringMatching(/9600.*115200|115200.*9600/),
        })
      );
    });

    it('should accept correct Serial.begin(115200)', () => {
      const code = `
        void setup() {
          Serial.begin(115200);
        }
        void loop() {
          Serial.println("OK");
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toEqual([]);
    });

    it('should detect commented-out Serial.begin()', () => {
      const code = `
        void setup() {
          // Serial.begin(115200);
          pinMode(13, OUTPUT);
        }
        void loop() {
          Serial.println("test");
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringContaining('commented'),
        })
      );
    });

    it('should detect Serial.begin in block comment', () => {
      const code = `
        void setup() {
          /* Serial.begin(115200); */
          pinMode(13, OUTPUT);
        }
        void loop() {
          Serial.println("test");
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringContaining('commented'),
        })
      );
    });

    it('should detect while(!Serial) antipattern', () => {
      const code = `
        void setup() {
          Serial.begin(115200);
          while (!Serial) delay(100);  // blocking!
        }
        void loop() {
          Serial.println("test");
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringMatching(/while.*Serial|Serial.*while/i),
        })
      );
    });

    it('should detect Serial.read without Serial.available check', () => {
      const code = `
        void loop() {
          int val = Serial.read();  // Missing Serial.available() check!
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'serial',
          message: expect.stringMatching(/Serial\.read.*available|available.*Serial\.read/i),
        })
      );
    });

    it('should allow Serial.read with Serial.available check', () => {
      const code = `
        void loop() {
          if (Serial.available()) {
            int val = Serial.read();
          }
        }
      `;

      const messages = parser.parseSerialConfiguration(code);
      const readWarnings = messages.filter((m: ParserMessage) => m.message.includes('Serial.read'));
      expect(readWarnings).toHaveLength(0);
    });
  });

  describe('parseStructure', () => {
    it('should detect missing void setup()', () => {
      const code = `
        void loop() {
          digitalWrite(13, HIGH);
        }
      `;

      const messages = parser.parseStructure(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'error',
          category: 'structure',
          message: expect.stringContaining('setup'),
        })
      );
    });

    it('should detect missing void loop()', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
      `;

      const messages = parser.parseStructure(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'error',
          category: 'structure',
          message: expect.stringContaining('loop'),
        })
      );
    });

    it('should accept valid structure with setup() and loop()', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
        }
      `;

      const messages = parser.parseStructure(code);
      expect(messages).toEqual([]);
    });

    it('should detect setup() with parameters (wrong signature)', () => {
      const code = `
        void setup(int x) {
          pinMode(13, OUTPUT);
        }
        void loop() {}
      `;

      const messages = parser.parseStructure(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'structure',
          message: expect.stringContaining('parameters'),
        })
      );
    });

    it('should allow void setup() with various spacing', () => {
      const code = `
        void   setup  (  )  {
          pinMode(13, OUTPUT);
        }
        void loop ( ) {
          digitalWrite(13, HIGH);
        }
      `;

      const messages = parser.parseStructure(code);
      expect(messages).toEqual([]);
    });
  });

  describe('parseHardwareCompatibility', () => {
    it('should warn about PWM on non-PWM pins (pin 2)', () => {
      const code = `
        void setup() {
          pinMode(2, OUTPUT);
        }
        void loop() {
          analogWrite(2, 128);  // Pin 2 doesn't support PWM on UNO
        }
      `;

      const messages = parser.parseHardwareCompatibility(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'hardware',
          message: expect.stringMatching(/PWM.*2|2.*PWM/),
        })
      );
    });

    it('should allow PWM on valid pins (3,5,6,9,10,11)', () => {
      const validPwmPins = [3, 5, 6, 9, 10, 11];
      for (const pin of validPwmPins) {
        const code = `
          void loop() {
            analogWrite(${pin}, 128);
          }
        `;
        const messages = parser.parseHardwareCompatibility(code);
        const pwmWarnings = messages.filter((m: ParserMessage) => m.message.includes('PWM'));
        expect(pwmWarnings).toHaveLength(0);
      }
    });

    // SPI and I2C pin warnings have been removed - not necessary for simulation

    it('should allow analog pins A0-A5', () => {
      const code = `
        void setup() {
          pinMode(A0, INPUT);
          pinMode(A1, INPUT);
          pinMode(A5, OUTPUT);
        }
        void loop() {}
      `;

      const messages = parser.parseHardwareCompatibility(code);
      const errors = messages.filter((m: ParserMessage) => m.type === 'error');
      expect(errors).toHaveLength(0);
    });

    it('should warn when digitalRead uses variable pins without any pinMode call', () => {
      const code = `
void setup()
{
    Serial.begin(115200);
}

void loop()
{
    Serial.print("Digital inputs: ");
    for (byte i = 0; i < 7; i++)
    {
        Serial.print(digitalRead(i));
        Serial.print(" ");
    }
    Serial.println();
    
    delay(100);
}
`;

      const messages = parser.parseHardwareCompatibility(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'hardware',
          message: expect.stringMatching(/digitalRead|pinMode|variable/i),
        })
      );
    });

    it('should NOT warn when digitalRead uses variable pins but pinMode is called in setup', () => {
      const code = `
void setup()
{
  Serial.begin(115200);
    for (byte i = 0; i < 7; i++)
  {
    pinMode(i,INPUT);
  }
}

void loop()
{
  Serial.print("Digital inputs: ");
  for (byte i = 0; i < 7; i++)
  {
    Serial.print(digitalRead(i));
    Serial.print(" ");
  }
  Serial.println();
}
`;

      const messages = parser.parseHardwareCompatibility(code);
      const pinConfigWarnings = messages.filter(
        (m: ParserMessage) => m.message.includes('digitalRead') && m.message.includes('pinMode')
      );
      expect(pinConfigWarnings).toHaveLength(0);
    });
  });

  describe('parsePinConflicts', () => {
    it('should detect pin used as both digital and analog', () => {
      const code = `
        void setup() {
          pinMode(A0, OUTPUT);  // Digital on pin A0
        }
        void loop() {
          int val = analogRead(A0);  // Also analog read!
        }
      `;

      const messages = parser.parsePinConflicts(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'hardware',
          message: expect.stringMatching(/both digital.*analog|analog.*both digital/i),
        })
      );
    });

    it('should allow same pin for multiple digital operations', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          digitalWrite(13, LOW);
        }
      `;

      const messages = parser.parsePinConflicts(code);
      const conflicts = messages.filter((m: ParserMessage) => m.message.includes('conflict'));
      expect(conflicts).toHaveLength(0);
    });

    it('should detect multiple pin conflicts', () => {
      const code = `
        void setup() {
          pinMode(A0, OUTPUT);
          pinMode(A2, OUTPUT);
        }
        void loop() {
          int v1 = analogRead(A0);
          int v2 = analogRead(A2);
        }
      `;

      const messages = parser.parsePinConflicts(code);
      // Note: Each pin that is both digital and analog is one conflict
      expect(messages.length).toBeGreaterThanOrEqual(1);
    });

    it('should detect digital and analog use on same pin', () => {
      const code = `
        void setup() {
          pinMode(A0, OUTPUT);
        }
        void loop() {
          digitalWrite(A0, HIGH);
          int val = analogRead(A0);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'hardware',
          message: expect.stringMatching(/both digital.*analog|analog.*digital/i)
        })
      );
    });

    it('should NOT warn when digital and analog pins are separate', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          int val = analogRead(A0);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages).toHaveLength(0);
    });

    it('should detect conflict with numeric pin notation', () => {
      const code = `
        void setup() {
          pinMode(14, OUTPUT);  // A0 = 14
        }
        void loop() {
          digitalWrite(14, HIGH);
          analogRead(14);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages.length).toBeGreaterThan(0);
    });
  });

  describe('parsePerformance', () => {
    it('should warn about while(true) loop', () => {
      const code = `
        void loop() {
          while (true) {
            digitalWrite(13, HIGH);
          }
        }
      `;

      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringMatching(/loop|infinite/i),
        })
      );
    });

    it('should warn about for loop without exit condition', () => {
      const code = `
        void loop() {
          for(int i = 0; ; i++) {
            digitalWrite(13, HIGH);
          }
        }
      `;

      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
        })
      );
    });

    it('should allow while loop with delay', () => {
      const code = `
        void loop() {
          while (analogRead(A0) > 500) {
            digitalWrite(13, HIGH);
            delay(100);
          }
        }
      `;

      const messages = parser.parsePerformance(code);
      const blockingWarnings = messages.filter((m: ParserMessage) =>
        m.message.includes('loop') && m.message.includes('blocking')
      );
      expect(blockingWarnings).toHaveLength(0);
    });

    it('should warn about large arrays', () => {
      const code = `
        int bigArray[2000];
        void setup() {}
        void loop() {}
      `;

      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('array'),
        })
      );
    });

    it('should warn about potential stack overflow from recursion', () => {
      const code = `
        void recursiveFunc(int n) {
          if (n > 0) {
            recursiveFunc(n - 1);
          }
        }
        void loop() {
          recursiveFunc(1000);
        }
      `;

      const messages = parser.parsePerformance(code);
      // Should detect the recursion pattern
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should detect while(true) inside a function', () => {
      const code = `
        void setup() {}
        void loop() {}
        void myFunc() {
          while(true) { delay(10); }
        }
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringMatching(/loop|infinite/i)
        })
      );
    });

    it('should NOT warn for reasonably sized arrays', () => {
      const code = `
        int smallArray[100];
        void setup() {}
        void loop() {}
      `;
      const messages = parser.parsePerformance(code);
      const arrayWarnings = messages.filter((m: ParserMessage) => m.message.includes('array'));
      expect(arrayWarnings).toHaveLength(0);
    });

    it('should detect arrays larger than 1000 elements', () => {
      const code = `
        int bigArray[5000];
        void setup() {}
        void loop() {}
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('array')
        })
      );
    });
  });

  describe('parseAll', () => {
    it('should combine all parser results', () => {
      const code = `
        void setup() {
          Serial.begin(9600);  // Wrong baudrate
          while (!Serial) delay(10);  // Blocking
          pinMode(2, OUTPUT);
          pinMode(A0, OUTPUT);
        }
        void loop() {
          while (true) {  // Infinite loop
            analogWrite(2, 128);  // PWM on wrong pin
            int val = analogRead(A0);  // Pin conflict
            Serial.read();  // Missing Serial.available
          }
        }
      `;

      const messages = parser.parseAll(code);

      // Should find multiple issues
      expect(messages.length).toBeGreaterThan(3);

      // Should have different categories
      const categories = new Set(messages.map((m: ParserMessage) => m.category));
      expect(categories.has('serial')).toBe(true);
      expect(categories.has('hardware')).toBe(true);
      expect(categories.has('performance')).toBe(true);
    });

    it('should return empty array for correct code', () => {
      const code = `
        void setup() {
          Serial.begin(115200);
          pinMode(5, OUTPUT);
        }
        void loop() {
          digitalWrite(5, HIGH);
          delay(100);
          digitalWrite(5, LOW);
          delay(100);
        }
      `;

      const messages = parser.parseAll(code);
      expect(messages).toEqual([]);
    });

    it('should assign unique IDs to each message', () => {
      const code = `
        void setup() {
          Serial.begin(9600);
          while (!Serial) delay(10);
        }
        void loop() {
          while (true) {
            digitalWrite(13, HIGH);
          }
        }
      `;

      const messages = parser.parseAll(code);
      const ids = messages.map((m: ParserMessage) => m.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(messages.length);
    });

    it('should include severity levels', () => {
      const code = `
        void setup() {
          Serial.begin(9600);
        }
        void loop() {}
      `;

      const messages = parser.parseAll(code);
      expect(messages.every((m: ParserMessage) => m.severity === 1 || m.severity === 2 || m.severity === 3)).toBe(true);
    });
  });

  describe('Message Properties', () => {
    it('should include line and column info when detectable', () => {
      const code = `
        void setup() {
          Serial.begin(9600);
        }
        void loop() {
          Serial.print("test");
        }
      `;

      const messages = parser.parseAll(code);
      // At least some messages should have line info
      const withLineInfo = messages.filter((m: ParserMessage) => m.line !== undefined);
      expect(withLineInfo.length).toBeGreaterThan(0);
    });

    it('should include suggestions for fixable issues', () => {
      const code = `
        void setup() {
          Serial.begin(9600);
        }
        void loop() {
          Serial.print("test");
        }
      `;

      const messages = parser.parseAll(code);
      const withSuggestions = messages.filter((m: ParserMessage) => m.suggestion !== undefined);
      expect(withSuggestions.length).toBeGreaterThan(0);
    });
  });

  describe('parsePerformance - Extended Tests', () => {
    it('should detect while(true) inside a function', () => {
      const code = `
        void setup() {}
        void loop() {}
        void myFunc() {
          while(true) { delay(10); }
        }
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('while(true)')
        })
      );
    });

    it('should detect for loop without condition: for(;;)', () => {
      const code = `
        void setup() {}
        void loop() {
          for(int i=0; ; i++) { 
            Serial.println(i);
          }
        }
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('infinite loop')
        })
      );
    });

    it('should detect arrays larger than 1000 elements', () => {
      const code = `
        int bigArray[5000];
        void setup() {}
        void loop() {}
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('5000')
        })
      );
    });

    it('should NOT warn for reasonably sized arrays', () => {
      const code = `
        int smallArray[100];
        void setup() {}
        void loop() {}
      `;
      const messages = parser.parsePerformance(code);
      const arrayWarnings = messages.filter(m => m.message.includes('array'));
      expect(arrayWarnings).toHaveLength(0);
    });

    it('should detect recursive function calls', () => {
      const code = `
        void setup() {}
        void loop() {}
        int factorial(int n) {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `;
      const messages = parser.parsePerformance(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'performance',
          message: expect.stringContaining('ecursive')
        })
      );
    });
  });

  describe('parsePinConflicts - Extended Tests', () => {
    it('should detect digital and analog use on same pin', () => {
      const code = `
        void setup() {
          pinMode(A0, OUTPUT);
        }
        void loop() {
          digitalWrite(A0, HIGH);
          int val = analogRead(A0);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          category: 'hardware',
          message: expect.stringContaining('digital')
        })
      );
    });

    it('should NOT warn when digital and analog pins are separate', () => {
      const code = `
        void setup() {
          pinMode(13, OUTPUT);
        }
        void loop() {
          digitalWrite(13, HIGH);
          int val = analogRead(A0);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages).toHaveLength(0);
    });

    it('should detect conflict with numeric pin notation', () => {
      const code = `
        void setup() {
          pinMode(14, OUTPUT);
        }
        void loop() {
          digitalWrite(14, HIGH);
          analogRead(14);
        }
      `;
      const messages = parser.parsePinConflicts(code);
      expect(messages.length).toBeGreaterThan(0);
    });
  });
});
