// Combine digital input, analog input, PWM output, and serial output.
const int buttonPin = 2;
const int pwmPin = 9;

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(pwmPin, OUTPUT);
}

void loop() {
  int sensor = analogRead(A0);
  int brightness = map(sensor, 0, 1023, 0, 255);
  if (digitalRead(buttonPin) == LOW) brightness = 255 - brightness;
  analogWrite(pwmPin, brightness);
  Serial.print("sensor=");
  Serial.print(sensor);
  Serial.print(" pwm=");
  Serial.println(brightness);
  delay(250);
}
