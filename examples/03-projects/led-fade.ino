// PWM LED Fade
// Fades an LED in and out using PWM (Pulse Width Modulation)

const int ledPin = 9; // PWM pin
int brightness = 0;
int fadeAmount = 5;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(115200);
  Serial.println("LED Fade Started");
}

void loop() {
  // Set the brightness using analogWrite (PWM)
  analogWrite(ledPin, brightness);
  
  // Print current brightness (0-255)
  Serial.print("Brightness: ");
  Serial.println(brightness);
  
  // Change brightness
  brightness = brightness + fadeAmount;
  
  // Reverse direction at the extremes
  if (brightness <= 0 || brightness >= 255) {
    fadeAmount = -fadeAmount;
  }
  
  // Wait 30ms for smooth fading effect
  delay(30);
}
