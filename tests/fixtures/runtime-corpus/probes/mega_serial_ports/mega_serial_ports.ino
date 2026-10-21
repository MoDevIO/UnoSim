// Four hardware serial ports of the Mega 2560: every port greets once and
// echoes what it receives in upper case; Serial logs "<port>:<character>".
HardwareSerial *const ports[3] = {&Serial1, &Serial2, &Serial3};

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600);
  Serial2.begin(19200);
  Serial3.begin(57600);
  Serial.println("READY");
  Serial1.println("hello 1");
  Serial2.println("hello 2");
  Serial3.println("hello 3");
}

void loop() {
  for (uint8_t i = 0; i < 3; i++) {
    while (ports[i]->available()) {
      char c = ports[i]->read();
      ports[i]->print((char)toupper(c));
      Serial.print(i + 1);
      Serial.print(':');
      Serial.println(c);
    }
  }
}
