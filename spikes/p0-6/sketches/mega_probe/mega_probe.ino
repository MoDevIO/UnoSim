// Spike P0.6 – Mega 2560 probe: four USARTs, PWM on timers 0/2/3/5, ADC with
// MUX5 (A15), time and memory layout.

void setup() {
  uint16_t spAtSetup = SP;
  Serial.begin(115200);
  Serial1.begin(9600);
  Serial2.begin(19200);
  Serial3.begin(57600);
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  Serial.print("sizeof int/long/double = ");
  Serial.print(sizeof(int)); Serial.print("/"); Serial.print(sizeof(long)); Serial.print("/");
  Serial.println(sizeof(double));
  Serial1.println("S1 hello");
  Serial2.println("S2 hello");
  Serial3.println("S3 hello");
  analogWrite(44, 25);
  analogWrite(45, 128);
  analogWrite(46, 200);
  analogWrite(2, 77);
  analogWrite(9, 99);
  analogWrite(13, 10);
  unsigned long t0 = millis();
  delay(587);
  Serial.print("delay(587) = ");
  Serial.println(millis() - t0);
  Serial.print("A0 = ");
  Serial.println(analogRead(A0));
  Serial.print("A15 = ");
  Serial.println(analogRead(A15));
  Serial.print("timer of D44 = ");
  Serial.println(digitalPinToTimer(44));
  Serial.print("RAMEND = 0x");
  Serial.println(RAMEND, HEX);
  Serial.print("SP at setup = 0x");
  Serial.println(spAtSetup, HEX);
  Serial.println("DONE");
}

void loop() {}
