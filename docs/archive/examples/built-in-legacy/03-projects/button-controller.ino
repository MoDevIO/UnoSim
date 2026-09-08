// Button Controller with Debouncing
// Reads a button and prints its state with debouncing

const int buttonPin = 2;
int buttonState = 0;
int lastButtonState = 0;
unsigned long lastDebounceTime = 0;
unsigned long debounceDelay = 50; // 50 ms debounce delay

void setup() {
  Serial.begin(115200);
  pinMode(buttonPin, INPUT);
  Serial.println("Button Controller Ready");
}

void loop() {
  int reading = digitalRead(buttonPin);
  
  // Check if the reading has changed
  if (reading != lastButtonState) {
    lastDebounceTime = millis();
  }
  
  // Check if the debounce delay has passed
  if ((millis() - lastDebounceTime) > debounceDelay) {
    if (reading != buttonState) {
      buttonState = reading;
      
      if (buttonState == HIGH) {
        Serial.println("Button Pressed!");
      } else {
        Serial.println("Button Released!");
      }
    }
  }
  
  lastButtonState = reading;
  delay(10);
}
