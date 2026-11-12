const byte PINS[]={2,3,4,5,8,10,11,12,13};
const byte P[][9]=
{{0,0,0,0,1,0 ,0 ,0, 0},
{0,0,1,0,0,0 ,1 ,0 ,0},
{0,0,1,0,1,0 ,1 ,0 ,0},
{1,0,1,0,0,0 ,1 ,0 ,1},
{1,0,1,0,1,0 ,1 ,0 ,1},
{1,1,1,0,0,0 ,1 ,1 ,1}};
const byte BTN = 7;
bool state = 0;
const bool DICING = 1;
const bool WAITING = 0;
void setup()
{
  Serial.begin(115200);
  for (byte i: PINS)
    pinMode(i, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
}
void loop()
{
//Serial.println(state);
  if ((state==WAITING)&&(digitalRead(BTN)==LOW))
  {
    run();
    digitalWrite(BTN, HIGH);
    state=WAITING;
  }
  delay(250);
}
void run()
{
  switch_all(0);
  delay(1000);
  for (unsigned int ms=50; ms<1000; ms+=200)
  {
    show(random(6));
    delay(ms);
  }
}
void show(const byte x)
{
  byte idx=0;
  for (byte i: PINS)
  {
    digitalWrite(i, P[x][idx]);
    idx++;
  }
}
void switch_all(bool v)
{
  for (byte i: PINS)
    digitalWrite(i, v);
}
void switchInit()
{
  static unsigned long t;
  static bool state;
  if (millis()-t>100)
    switch_all(state!=state);
}
