const byte PINS[] = { 11, 10, 9, 6, 5, 3 };
const byte NUM_LEDS = sizeof(PINS) / sizeof(PINS[0]); // Automatisch berechnet!

// Konfiguration des Welleneffekts
const byte LED_OFFSET = 5; // Abstand zwischen LEDs im Welleneffekt
const byte FADE_DURATION = 20; // Dauer des Fade-Effekts

// Berechnete Werte: Die Pause muss groß genug sein, damit alle LEDs komplett 
// durch den Fade laufen können (centerOffset berücksichtigen)
const byte CENTER_OFFSET = LED_OFFSET * (NUM_LEDS - 1) / 2; // = 5 * 5 / 2 = 12 (abgerundet)
const byte PAUSE_DURATION = CENTER_OFFSET + LED_OFFSET; // Puffer für äußerste LED
const byte FADE_START = PAUSE_DURATION;
const byte FADE_END = FADE_START + FADE_DURATION;
const byte ARRAY_SIZE = FADE_END + PAUSE_DURATION;

const byte sin_fade_values[] = {
  // FADE UP + FADE DOWN
  3, 11, 24, 43, 64, 89, 114, 141, 166, 191, 212, 230, 244, 252, 255,
  252, 244, 230, 212, 191, 166, 141, 114, 89, 64, 43, 24, 11, 3
};

// Sicheres Setzen der LED-Helligkeit mit Bereichsprüfung
inline void switchLED(byte ledIndex, int arrayIndex) {
  byte value = 0;
  if (arrayIndex >= FADE_START && arrayIndex < FADE_END) {
    value = sin_fade_values[arrayIndex - FADE_START];
  }
  analogWrite(PINS[ledIndex], value);
}

// Alle LEDs mit zeitversetzten Offsets ansteuern
void switchLEDs(int position) {
  const int centerOffset = LED_OFFSET * (NUM_LEDS - 1) / 2;
  for (byte i = 0; i < NUM_LEDS; i++) {
    switchLED(i, position + (i * LED_OFFSET) - centerOffset);
  }
}

void setup() {
  Serial.begin(115200);
  
  // Alle LED-Pins als Ausgänge konfigurieren
  for (byte i = 0; i < NUM_LEDS; i++) {
    pinMode(PINS[i], OUTPUT);
    digitalWrite(PINS[i], LOW); // Sicherer als analogWrite für initialen Aus-Zustand
  }
  
  Serial.println("LED Sinus-Fade gestartet"); // F() spart RAM
}

void loop() {
  static int position = 0;
  static int8_t direction = 1;
  
  switchLEDs(position);
  
  position += direction;
  direction = (position >= ARRAY_SIZE - 1) ? -1 : (position <= 0) ? 1 : direction;
  
  delay(20);
}