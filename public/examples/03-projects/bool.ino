bool A, B, C;
void setup()
{
  Serial.begin(115200);
  for (byte i = 0; i < 2; i++)
    for (byte j = 0; j < 2; j++)
      for (byte k = 0; k < 2; k++)
      {
        Serial.println(!(k || j) || !(i || j) || !(k || i));
        // delay(1);
      }
}

void loop()
{
}