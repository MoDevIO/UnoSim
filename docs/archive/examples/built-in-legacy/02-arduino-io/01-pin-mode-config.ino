// Pin Mode Configuration
// Learn: How to configure pins as INPUT or OUTPUT and use pull-up resistors

const int inputPin = 2;
const int outputPin = 13;

void setup() {
  Serial.begin(115200);
  
  // Configure pins
  pinMode(inputPin, INPUT_PULLUP);  // Input with internal pull-up resistor
  pinMode(outputPin, OUTPUT);
  
  Serial.println("Pin Mode Configuration Example");
  Serial.println("=============================");
  Serial.println("Input Pin: configured with internal pull-up");
  Serial.println("Output Pin: ready to drive signals");
}

void loop() {
  // Read input pin
  int inputState = digitalRead(inputPin);
  
  // Write to output pin
  digitalWrite(outputPin, inputState == LOW ? HIGH : LOW);
  
  // Print status
  Serial.print("Input State: ");
  Serial.print(inputState == HIGH ? "HIGH" : "LOW");
  Serial.print(" | Output State: ");
  Serial.println(inputState == LOW ? "HIGH" : "LOW");
  
  delay(250);
}
