// Pin model probe: output, open input, pull-up, and an input that the sketch
// briefly makes an OUTPUT (200–300 ms). Prints every change of D2/D3.
void setup() {
  Serial.begin(115200);
  pinMode(13, OUTPUT);
  pinMode(2, INPUT);
  pinMode(3, INPUT_PULLUP);
  Serial.println("READY");
}

void loop() {
  static uint8_t phase = 0;
  static int last2 = -1, last3 = -1;
  unsigned long t = millis();
  digitalWrite(13, (t / 10) % 2);
  if (phase == 0 && t >= 200) {
    pinMode(2, OUTPUT);
    digitalWrite(2, HIGH);
    phase = 1;
    Serial.println("D2 OUTPUT");
  }
  if (phase == 1 && t >= 300) {
    pinMode(2, INPUT);
    phase = 2;
    Serial.println("D2 INPUT");
  }
  int v2 = digitalRead(2), v3 = digitalRead(3);
  if (v2 != last2 || v3 != last3) {
    Serial.print("D2=");
    Serial.print(v2);
    Serial.print(" D3=");
    Serial.println(v3);
    last2 = v2;
    last3 = v3;
  }
}
