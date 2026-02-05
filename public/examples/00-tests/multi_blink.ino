class Blinker {
  private:
    int pin;
    unsigned long interval;
    unsigned long lastUpdate;
    bool state;

  public:
    // Konstruktor initialisiert Pin und Intervall
    Blinker(int p, unsigned long i) {
      pin = p;
      interval = i;
      lastUpdate = 0;
      state = LOW;
    }

    void setup() {
      pinMode(pin, OUTPUT);
    }

    void update(unsigned long currentMillis) {
      if (currentMillis - lastUpdate >= interval) {
        lastUpdate = currentMillis;
        state = !state;
        digitalWrite(pin, state);
      }
    }
};

// Instanziierung der LEDs mit verschiedenen Frequenzen

Blinker leds[] = {
  Blinker(13, 100),
  Blinker(12, 30),
  Blinker(11, 10),
  Blinker(10, 1)
};

void setup() {
  for (int i = 0; i < 4; i++) {
    leds[i].setup();
  }
}

void loop() {
  for (int i = 3; i < 4; i++) {
    leds[i].update(millis());
  }
}