// Dieses Beispiel lässt 4 LED mit unterschiedlichen Frequenzen blinken

#include "led_controller.h"

LEDController led1(4);
LEDController led2(5);
LEDController led3(6);
LEDController led4(7);

void setup()
{}

void loop()
{
  led1.blink(100);
  led2.blink(200);
  led3.blink(300);
  led4.blink(400);
}

/*

Kopiervorlage für den Wokwi-Simulator:

{
  "version": 1,
  "author": "Anonymous maker",
  "editor": "wokwi",
  "parts": [
    { "type": "wokwi-arduino-uno", "id": "uno", "top": 0, "left": 0, "attrs": {} },
    {
      "type": "wokwi-led",
      "id": "led1",
      "top": -107.26,
      "left": 110.72,
      "attrs": { "color": "red" }
    },
    {
      "type": "wokwi-led",
      "id": "led2",
      "top": -108.13,
      "left": 166.95,
      "attrs": { "color": "red" }
    },
    {
      "type": "wokwi-led",
      "id": "led3",
      "top": -107.26,
      "left": 220.58,
      "attrs": { "color": "red" }
    },
    {
      "type": "wokwi-led",
      "id": "led4",
      "top": -107.27,
      "left": 277.68,
      "attrs": { "color": "red" }
    }
  ],
  "connections": [
    [ "led1:C", "uno:GND.1", "green", [ "v0" ] ],
    [ "led1:A", "uno:7", "green", [ "v0" ] ],
    [ "led2:C", "uno:GND.1", "green", [ "v0" ] ],
    [ "led2:A", "uno:6", "green", [ "v0" ] ],
    [ "led3:C", "uno:GND.1", "green", [ "v0" ] ],
    [ "led3:A", "uno:5", "green", [ "v0" ] ],
    [ "led4:C", "uno:GND.1", "green", [ "v0" ] ],
    [ "uno:4", "led4:A", "green", [ "v0" ] ]
  ]
}
*/
