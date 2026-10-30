// ArduinoJson 6 minimal example: read a small JSON object, change a value, print the result.
// The results appear in the serial monitor.
#include <ArduinoJson.h>

void setup() {
  Serial.begin(115200);

  StaticJsonDocument<128> doc;
  DeserializationError error = deserializeJson(doc, "{\"sensor\":\"temperature\",\"value\":21.5,\"count\":3}");
  if (error) {
    Serial.print("error: ");
    Serial.println(error.c_str());
    return;
  }

  Serial.print("sensor: ");
  Serial.println(doc["sensor"].as<const char*>());
  Serial.print("count before: ");
  Serial.println(doc["count"].as<int>());

  doc["count"] = doc["count"].as<int>() + 1;
  serializeJson(doc, Serial);
  Serial.println();

  // Invalid input is reported, not guessed.
  StaticJsonDocument<64> broken;
  error = deserializeJson(broken, "{\"value\":");
  Serial.print("invalid input: ");
  Serial.println(error.c_str());
}

void loop() {
}
