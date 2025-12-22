void setup()
{
    Serial.begin(115200);
    for (byte i=0; i<7; i++) {
        pinMode(i, INPUT);
    }
    for (byte i=7; i<14; i++) {
        pinMode(i, INPUT_PULLUP);
    }
}

void loop()
{
    analogWrite(5, 128);
    digitalWrite(6, !digitalRead(6));
    delay(100);
}