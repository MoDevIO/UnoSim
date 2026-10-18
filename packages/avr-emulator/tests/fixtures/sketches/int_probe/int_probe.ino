// Proposal annex B (docs/proposals/browser-emulation.md).
void setup() {
  Serial.begin(115200);
  int i = 32767;
  i++;
  Serial.print("int 32767 + 1 = ");
  Serial.println(i);
  unsigned int u = 65535;
  u++;
  Serial.print("unsigned int 65535 + 1 = ");
  Serial.println(u);
  int produkt = 300 * 200;
  Serial.print("int 300 * 200 = ");
  Serial.println(produkt);
  Serial.print("sizeof int/long/float/double = ");
  Serial.print(sizeof(int)); Serial.print("/"); Serial.print(sizeof(long)); Serial.print("/");
  Serial.print(sizeof(float)); Serial.print("/"); Serial.println(sizeof(double));
  Serial.print("print(2.5) = ");
  Serial.println(2.5);
  Serial.println("DONE");
}
void loop() {}
