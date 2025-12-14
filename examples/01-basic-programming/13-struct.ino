// 13 - Store data with structs
// Learn: Structure for related data

// Define a structure for a person
struct Person {
  char name[20];
  int age;
  float height;
  boolean isStudent;
};

void setup() {
  Serial.begin(115200);
  Serial.println("=== Structs ===");
}

void loop() {
  // Create some people
  Person person1;
  person1.isStudent = true;
  person1.age = 15;
  person1.height = 1.65;
  
  Person person2;
  person2.isStudent = false;
  person2.age = 35;
  person2.height = 1.80;
  
  Serial.println("Person 1:");
  Serial.print("  Age: ");
  Serial.println(person1.age);
  Serial.print("  Height: ");
  Serial.print(person1.height);
  Serial.println(" m");
  Serial.print("  Student: ");
  Serial.println(person1.isStudent ? "Yes" : "No");
  
  Serial.println();
  
  Serial.println("Person 2:");
  Serial.print("  Age: ");
  Serial.println(person2.age);
  Serial.print("  Height: ");
  Serial.print(person2.height);
  Serial.println(" m");
  Serial.print("  Student: ");
  Serial.println(person2.isStudent ? "Yes" : "No");
  
  Serial.println();
  
  // Array of structs
  Person people[2] = {person1, person2};
  
  Serial.println("All people:");
  for (int i = 0; i < 2; i++) {
    Serial.print("Person ");
    Serial.print(i + 1);
    Serial.print(" - Age: ");
    Serial.println(people[i].age);
  }
  
  Serial.println();
  
  delay(10000);
}
