// INPUT_PULLUP reads HIGH while nothing pulls the pin down; a level driven
// from outside wins as long as the sketch does not make the pin an OUTPUT.
// Prints a line whenever one of the inputs changes.
int lastPullup = -1;
int lastInput = -1;

void setup() {
  Serial.begin(115200);
  pinMode(2, INPUT_PULLUP);
  pinMode(4, INPUT);
  pinMode(6, OUTPUT);
  digitalWrite(6, HIGH);
}

void loop() {
  int pullup = digitalRead(2);
  int input = digitalRead(4);
  if (pullup != lastPullup || input != lastInput) {
    Serial.print("D2=");
    Serial.print(pullup);
    Serial.print(" D4=");
    Serial.print(input);
    Serial.print(" D6=");
    Serial.println(digitalRead(6));
    lastPullup = pullup;
    lastInput = input;
  }
}
