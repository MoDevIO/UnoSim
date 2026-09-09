// Dieses Beispiel lässt 4 LED als Lauflicht arbeiten
//  - die Geschwindigkeit wechselt -

#include "led_controller.h"

// Definiere die Pins, an denen die LEDs angeschlossen sind:
byte pins[] = {4, 5, 6, 7};

// Erzeuge ein ledchain-Objekt:
// 1. Parameter: Größe des Pin-Arrays
// 2. Parameter: Pin-Array
// 3. Parameter: RIGHT=von rechts nach links (default)
//               LEFT= von links nach rechts
//               TOGGLE=von links nach rechts nach links nach ...
LEDChain ledchain(4, pins, TOGGLE);

void setup()
{}

void loop()
{
  uint32_t t=millis();

  while (millis()-t<3000)
    ledchain.run(300);

  ledchain.off();
  t=millis();


  delay(1000);

  while (millis()-t<3000)
    ledchain.run(100);

  ledchain.off();
  t=millis();

  delay(1000);
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
