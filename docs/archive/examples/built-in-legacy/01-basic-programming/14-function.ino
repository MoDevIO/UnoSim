// 14 - Modularize with functions
// Learn: Functions for code reuse

// Function declarations
void greet();
int add(int a, int b);
void printArray(int arr[], int length);
float calculateAverage(int arr[], int length);

void setup() {
  Serial.begin(115200);
  Serial.println("=== Functions ===");
}

void loop() {
  // Functions without parameters and return value
  greet();
  
  Serial.println();
  
  // Functions with parameters and return value
  int result = add(5, 3);
  Serial.print("5 + 3 = ");
  Serial.println(result);
  
  Serial.println();
  
  // Array and functions
  int grades[5] = {85, 92, 78, 88, 95};
  Serial.print("Grades: ");
  printArray(grades, 5);
  
  float average = calculateAverage(grades, 5);
  Serial.print("Average: ");
  Serial.println(average);
  
  Serial.println();
  
  delay(10000);
}

// Function without parameters and without return value
void greet() {
  Serial.println("Welcome to the functions demo!");
  Serial.println("This is a reusable function.");
}

// Function with parameters and return value
int add(int a, int b) {
  int sum = a + b;
  return sum;
}

// Function with array as parameter
void printArray(int arr[], int length) {
  for (int i = 0; i < length; i++) {
    Serial.print(arr[i]);
    if (i < length - 1) {
      Serial.print(", ");
    }
  }
  Serial.println();
}

// Function that calculates an average
float calculateAverage(int arr[], int length) {
  int sum = 0;
  for (int i = 0; i < length; i++) {
    sum = sum + arr[i];
  }
  return sum / (float)length;
}
