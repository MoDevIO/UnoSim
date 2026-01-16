void setup()
{
    //Serial.begin(115200);
    pinMode(A0, INPUT);
    
    for (byte i=0; i<7; i++) {
        pinMode(i, INPUT);
    }
    for (byte i=7; i<15; i++) {
        pinMode(i, INPUT_PULLUP);
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
    Serial.print(" | Analog inputs: ");
    for (byte i = 16; i < 20; i++)
    {
        Serial.print(analogRead(i));
        Serial.print(" ");
    }
    Serial.println();
    analogWrite(5, 128);
    digitalWrite(6, !digitalRead(6));
    
    delay(100);
}