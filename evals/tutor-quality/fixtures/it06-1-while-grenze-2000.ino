const unsigned int GRENZE = 2000;

void setup() {
  Serial.begin(115200);

  unsigned int wert = 1;
  byte schritte = 0;

  while (wert < GRENZE) {
    Serial.println(wert);
    wert = wert * 2;
    schritte++;
  }

  Serial.print("Schritte: ");
  Serial.println(schritte);
  Serial.print("Endwert: ");
  Serial.println(wert);
}

void loop() {
}
