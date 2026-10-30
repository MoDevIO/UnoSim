// CircularBuffer minimal example: fill a ring buffer of four values, overflow it, read it back.
// The results appear in the serial monitor.
#include <CircularBuffer.hpp>

CircularBuffer<int, 4> buffer;

void setup() {
  Serial.begin(115200);

  for (int value = 1; value <= 6; value++) {
    // push() returns false when the buffer was full and the oldest value was overwritten.
    bool kept = buffer.push(value);
    Serial.print("push ");
    Serial.print(value);
    Serial.println(kept ? "" : " - overflow, oldest value dropped");
  }

  Serial.print("size ");
  Serial.print(buffer.size());
  Serial.print(" of ");
  Serial.println(buffer.capacity);

  Serial.print("read");
  while (!buffer.isEmpty()) {
    Serial.print(' ');
    Serial.print(buffer.shift());
  }
  Serial.println();
  Serial.println(buffer.isEmpty() ? "buffer empty" : "buffer not empty");
}

void loop() {
}
