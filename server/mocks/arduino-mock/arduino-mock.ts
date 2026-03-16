/**
 * Shared Arduino Mock code for Compiler and Runner
 *
 * Orchestrator: assembles ARDUINO_MOCK_CODE from modular C++ template segments.
 * Each segment is maintained in its own file; this file only handles the
 * assembly order and the top-level C++ header block.
 *
 * Assembly order (mirrors C++ declaration dependencies):
 *  1. C++ #includes + using namespace std
 *  2. ARDUINO_CONSTANTS_CODE   — typedefs, macros, math constants
 *  3. ARDUINO_GLOBALS          — global state (rng, mutex, pause/resume vars, fwd-decl)
 *  4. ARDUINO_STRING_CLASS     — Arduino String class
 *  5. ARDUINO_PIN_STATE_INIT   — pinModes[] / pinValues[] arrays
 *  6. ARDUINO_REGISTRY_STRUCTURES — IOOperation / IOPinRecord structs
 *  7. ARDUINO_REGISTRY_LOGIC   — ioRegistry map + GPIO functions
 *  8. ARDUINO_TIMING_AND_RANDOM — timing (millis/micros) + random functions
 *  9. ARDUINO_SERIAL_CLASS     — SerialClass + Serial instance + delay()
 * 10. ARDUINO_STDIN_HANDLER    — stdin protocol dispatcher + serialInputReader()
 */

import {
  ARDUINO_CONSTANTS_CODE,
  ARDUINO_STRING_CLASS,
  ARDUINO_REGISTRY_STRUCTURES,
  ARDUINO_PIN_STATE_INIT,
  ARDUINO_REGISTRY_LOGIC,
  ARDUINO_GLOBALS,
  ARDUINO_TIMING_AND_RANDOM,
  ARDUINO_SERIAL_CLASS,
  ARDUINO_STDIN_HANDLER,
} from './index';

// Assemble ARDUINO_MOCK_CODE from all modular segments.
// The C++ #include block is the only content inlined here; every other section
// is maintained in its own module file (see imports above).
export const ARDUINO_MOCK_CODE =
  // 1. C++ headers — only inlined section (no module dependency)
  `
// Simulated Arduino environment
// PATCH: version bump comment
// PATCH2: additional line to change hash
#include <iostream>
#include <string>
#include <cmath>
#include <stdint.h>
#include <thread>
#include <chrono>
#include <random>
#include <cstdlib>
#include <ctime>
#include <queue>
#include <mutex>
#include <condition_variable>
#include <atomic>
#include <cstring>
#include <algorithm> // For std::tolower/toupper in String
#include <iomanip>   // For std::setprecision
#include <sstream>   // For std::ostringstream
#include <unistd.h>  // For STDIN_FILENO
#include <sys/select.h> // For select()
#include <map>       // For I/O Registry
#include <vector>    // For I/O Registry operations
using namespace std;
` +
  // 2\u201310. Modular segments in C++ declaration-dependency order
  ARDUINO_CONSTANTS_CODE +
  ARDUINO_GLOBALS +
  ARDUINO_STRING_CLASS +
  ARDUINO_PIN_STATE_INIT +
  ARDUINO_REGISTRY_STRUCTURES +
  ARDUINO_REGISTRY_LOGIC +
  ARDUINO_TIMING_AND_RANDOM +
  ARDUINO_SERIAL_CLASS +
  ARDUINO_STDIN_HANDLER;
