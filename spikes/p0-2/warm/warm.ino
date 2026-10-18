void setup(){Serial.begin(9600);pinMode(13,OUTPUT);analogWrite(3,1);analogRead(A0);}
void loop(){digitalWrite(13,!digitalRead(13));delay(10);Serial.println(millis());}
