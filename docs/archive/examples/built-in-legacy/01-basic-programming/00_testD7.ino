void setup()
{
    Serial.begin(115200);
    Serial.println("D7 gestartet");
}

void loop()
{
    static bool state = false;
    state = !state;
    digitalWrite(7, state);
    delay(20);
}