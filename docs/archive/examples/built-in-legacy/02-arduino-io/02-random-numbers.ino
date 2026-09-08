// Random Number Generator
// Learn: How to generate random numbers for games or simulations

void setup() {
  Serial.begin(115200);
  
  // Seed the random number generator with a non-repeating value
  randomSeed(analogRead(A0));
  
  Serial.println("Random Number Generator Example");
  Serial.println("==============================");
}

void loop() {
  // Generate random numbers
  int randomNum1 = random(1, 7);        // 1-6 (like a dice)
  int randomNum2 = random(1, 101);      // 1-100
  int randomNum3 = random(256);         // 0-255
  
  // Print random numbers
  Serial.print("Dice roll: ");
  Serial.print(randomNum1);
  Serial.print(" | Number 1-100: ");
  Serial.print(randomNum2);
  Serial.print(" | Byte value: ");
  Serial.println(randomNum3);
  
  delay(1000);
}
