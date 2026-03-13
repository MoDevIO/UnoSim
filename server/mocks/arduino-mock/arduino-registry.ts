/**
 * Arduino Registry and Helper Structures
 * 
 * This file exports the C++ code for I/O registry tracking structures
 * and operations used during Arduino simulation.
 */

/**
 * I/O Registry tracking structures - for tracking pin usage patterns
 */
export const ARDUINO_REGISTRY_STRUCTURES = `
// Runtime I/O Registry tracking
struct IOOperation {
    int line;
    std::string operation;
};

struct IOPinRecord {
    std::string pin;
    bool defined;
    int definedLine;
    int pinMode;  // 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP
    std::vector<IOOperation> operations;
};
`;

/**
 * Pin state tracking initialization code
 */
export const ARDUINO_PIN_STATE_INIT = `
// Pin state tracking for visualization
static int pinModes[20] = {0};   // 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP
static std::atomic<int> pinValues[20];  // Thread-safe: Digital 0=LOW, 1=HIGH

// Initialize atomic array (called before main)
struct PinValuesInitializer {
    PinValuesInitializer() {
        for (int i = 0; i < 20; i++) {
            pinValues[i].store(0);
        }
    }
} pinValuesInit;
`;
