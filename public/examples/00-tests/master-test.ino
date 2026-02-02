// Pins für den Test
const int ledPin = 13;  // Digital Toggle
const int pwmPin = 9;   // PWM Glättungs-Test
const int pulsePin = 2; // High-Frequency Stress

void setup()
{
    Serial.begin(115200);
    pinMode(ledPin, OUTPUT);
    pinMode(pwmPin, OUTPUT);
    pinMode(pulsePin, OUTPUT);
    Serial.println("--- System Ready: Type '1' to toggle LED, '2' for PWM sweep ---");
}

void loop()
{
    // 1. Serial Input & Digital Logic Test
    if (Serial.available() > 0)
    {
        char cmd = Serial.read();
        if (cmd == '1')
        {
            bool currentState = digitalRead(ledPin);
            digitalWrite(ledPin, !currentState);
            Serial.print("LED State changed to: ");
            Serial.println(!currentState ? "HIGH" : "LOW");
        }
        if (cmd == '2')
        {
            Serial.println("Starting PWM Sweep...");
            for (int i = 0; i <= 255; i++)
            {
                analogWrite(pwmPin, i);
                delay(5); // Schneller Sweep für rAF-Validierung
            }
            Serial.println("Sweep complete.");
        }
    }

    // 2. High-Frequency Background Stress (Validiert Debouncing)
    // Erzeugt konstante Pin-Events, die vom RegistryManager gebatched werden müssen
    digitalWrite(pulsePin, HIGH);
    digitalWrite(pulsePin, LOW);
}