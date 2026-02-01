void setup()
{
    Serial.begin(115200);
    Serial.print("1");
    delay(1000);
}
void loop()
{   Serial.print("2");
    delay(1000);
    Serial.println("\nHello, World!");
    delay(1000);
}