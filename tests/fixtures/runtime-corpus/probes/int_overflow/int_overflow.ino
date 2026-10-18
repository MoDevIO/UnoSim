// Wrap-around of integer arithmetic on the 16- and 32-bit AVR types. The
// operands are volatile so that the compiler cannot fold the expressions;
// the signed results describe this toolchain, not the C++ standard.
volatile int vInt = 32767;
volatile unsigned int vUint = 65535;
volatile byte vByte = 255;
volatile long vLong = 2147483647L;
volatile unsigned long vUlong = 4294967295UL;
volatile int a = 200;
volatile int b = 200;

void setup() {
  Serial.begin(115200);
  Serial.print("int 32767+1 = ");
  Serial.println(vInt + 1);
  Serial.print("int after ++ = ");
  vInt++;
  Serial.println(vInt);
  Serial.print("unsigned int 65535+1 = ");
  vUint++;
  Serial.println(vUint);
  Serial.print("byte 255+1 = ");
  vByte++;
  Serial.println(vByte);
  Serial.print("long max+1 = ");
  vLong++;
  Serial.println(vLong);
  Serial.print("unsigned long max+1 = ");
  vUlong++;
  Serial.println(vUlong);
  Serial.print("200*200 as int = ");
  Serial.println(a * b);
  Serial.print("200*200 as long = ");
  Serial.println((long)a * b);
  Serial.print("200*200 as unsigned = ");
  Serial.println((unsigned int)a * b);
  Serial.print("-7 / 2 = ");
  volatile int seven = -7;
  Serial.println(seven / 2);
  Serial.print("-7 % 3 = ");
  Serial.println(seven % 3);
  Serial.print("1 << 15 = ");
  volatile int one = 1;
  Serial.println(one << 15);
  Serial.println("DONE");
}

void loop() {}
