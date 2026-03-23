/**
 * Arduino Constants and Type Definitions
 * 
 * This file exports the C++ code segments for Arduino constants,
 * pin modes, and mathematic definitions that are injected into
 * the ARDUINO_MOCK_CODE template string.
 */

/**
 * Basic Arduino type definitions and constants
 * This includes pin modes, digital pin states, and math constants
 */
export const ARDUINO_CONSTANTS_CODE = `
// Arduino specific types
typedef bool boolean;
#define byte uint8_t

// Pin modes and states
#define HIGH 0x1
#define LOW  0x0
#define INPUT 0x0
#define OUTPUT 0x1
#define INPUT_PULLUP 0x2
#define LED_BUILTIN 13

// Analog pins
#define A0 14
#define A1 15
#define A2 16
#define A3 17
#define A4 18
#define A5 19

// Math constants
#define PI 3.1415926535897932384626433832795
#define HALF_PI 1.5707963267948966192313216916398
#define TWO_PI 6.283185307179586476925286766559
#define DEG_TO_RAD 0.017453292519943295769236907684886
#define RAD_TO_DEG 57.295779513082320876798154814105

// Number format constants for print()
#define DEC 10
#define HEX 16
#define OCT 8
#define BIN 2

// Math functions
#define abs(x) ((x)>0?(x):-(x))
#define min(a,b) ((a)<(b)?(a):(b))
#define max(a,b) ((a)>(b)?(a):(b))
#define sq(x) ((x)*(x))
#define constrain(amt,low,high) ((amt)<(low)?(low):((amt)>(high)?(high):(amt)))
#define map(value, fromLow, fromHigh, toLow, toHigh) (toLow + (value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow))
`;
