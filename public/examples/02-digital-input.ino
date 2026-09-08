// Read a digital input and report its state.
const int buttonPin = 2;

void setup() {
  Serial.begin(9600);
  pinMode(buttonPin, INPUT_PULLUP);
}

void loop() {
  Serial.println(digitalRead(buttonPin) == LOW ? "pressed" : "released");
  delay(500);
}
