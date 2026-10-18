// Sizes and limits of the AVR data types (avr-gcc ABI): int is 16 bit,
// double is 32 bit, pointers are 16 bit.
void setup() {
  Serial.begin(115200);
  Serial.print("bool ");
  Serial.println(sizeof(bool));
  Serial.print("char ");
  Serial.println(sizeof(char));
  Serial.print("short ");
  Serial.println(sizeof(short));
  Serial.print("int ");
  Serial.println(sizeof(int));
  Serial.print("long ");
  Serial.println(sizeof(long));
  Serial.print("long long ");
  Serial.println(sizeof(long long));
  Serial.print("float ");
  Serial.println(sizeof(float));
  Serial.print("double ");
  Serial.println(sizeof(double));
  Serial.print("pointer ");
  Serial.println(sizeof(void *));
  Serial.print("max uint ");
  Serial.println((unsigned int)-1);
  Serial.print("max ulong ");
  Serial.println((unsigned long)-1);
  Serial.print("max int ");
  Serial.println((int)(((unsigned int)-1) >> 1));
  Serial.println("DONE");
}

void loop() {}
