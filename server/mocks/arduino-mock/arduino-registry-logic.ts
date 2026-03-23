/**
 * Arduino Registry Logic — Step A extraction
 *
 * Exports the C++ code for:
 *  - The `ioRegistry` global map
 *  - initIORegistry() / outputIORegistry()
 *  - GPIO functions (pinMode, digitalWrite, digitalRead, analogWrite, analogRead)
 *  - trackIOOperation() helper
 *
 * All functions depend on:
 *  - `cerrMutex` (declared in ARDUINO_GLOBALS)
 *  - `pinModes[]` / `pinValues[]` (declared in ARDUINO_PIN_STATE_INIT)
 *  - `IOPinRecord` / `IOOperation` structs (declared in ARDUINO_REGISTRY_STRUCTURES)
 */

export const ARDUINO_REGISTRY_LOGIC = `
static std::map<int, IOPinRecord> ioRegistry;

void initIORegistry() {
    ioRegistry.clear();
    // Pre-populate all 20 Arduino pins
    for (int i = 0; i <= 13; i++) {
        IOPinRecord rec;
        rec.pin = std::to_string(i);
        rec.defined = false;
        rec.definedLine = 0;
        rec.pinMode = 0;
        rec.operations = {};
        ioRegistry[i] = rec;
    }
    for (int i = 14; i <= 19; i++) {
        IOPinRecord rec;
        rec.pin = "A" + std::to_string(i - 14);
        rec.defined = false;
        rec.definedLine = 0;
        rec.pinMode = 0;
        rec.operations = {};
        ioRegistry[i] = rec;
    }
}

void outputIORegistry() {
    std::lock_guard<std::mutex> lock(cerrMutex);
    std::cerr << "[[IO_REGISTRY_START]]" << std::endl;
    std::cerr.flush();
    for (const auto& pair : ioRegistry) {
        const auto& rec = pair.second;
        std::cerr << "[[IO_PIN:" << rec.pin << ":" << (rec.defined ? "1" : "0") << ":" << rec.definedLine << ":" << rec.pinMode;
        // Limit to first 5 operations per pin to avoid buffer overflow
        int opCount = 0;
        for (const auto& op : rec.operations) {
            if (opCount >= 5) break;  // Only output first 5 operations
            std::cerr << ":" << op.operation << "@" << op.line;
            opCount++;
        }
        if (rec.operations.size() > 5) {
            std::cerr << ":_count@" << rec.operations.size();  // Append count if more than 5
        }
        std::cerr << "]]" << std::endl;
    }
    std::cerr << "[[IO_REGISTRY_END]]" << std::endl;
    std::cerr.flush();
}

// GPIO Functions with state tracking
void pinMode(int pin, int mode) {
    if (pin >= 0 && pin < 20) {
        pinModes[pin] = mode;
        // Send pin state update via stderr (special protocol)
        { std::lock_guard<std::mutex> lock(cerrMutex);
          std::cerr << "[[PIN_MODE:" << pin << ":" << mode << "]]" << std::endl; }
        
        // Track in I/O Registry - add pinMode as an operation with mode info
        if (ioRegistry.find(pin) != ioRegistry.end()) {
            ioRegistry[pin].defined = true;
            ioRegistry[pin].definedLine = 0; // Line number not available at runtime
            ioRegistry[pin].pinMode = mode; // Keep the pinMode field updated for backwards compatibility
            
            // Track pinMode in operations (format: "pinMode:MODE" where MODE is 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP)
            std::string pinModeOp = "pinMode:" + std::to_string(mode);
            ioRegistry[pin].operations.push_back({0, pinModeOp});
        }
    }
}

// Helper: Track IO operation (consolidates redundant tracking code)
inline void trackIOOperation(int pin, const std::string& operation) {
    if (ioRegistry.find(pin) != ioRegistry.end()) {
        bool opExists = false;
        for (const auto& op : ioRegistry[pin].operations) {
            if (op.operation == operation) {
                opExists = true;
                break;
            }
        }
        if (!opExists) {
            ioRegistry[pin].operations.push_back({0, operation});
        }
    }
}

void digitalWrite(int pin, int value) {
    if (pin >= 0 && pin < 20) {
        int oldValue = pinValues[pin].load(std::memory_order_seq_cst);
        pinValues[pin].store(value, std::memory_order_seq_cst);
        // Only send update if value actually changed (avoid stderr flooding)
        if (oldValue != value) {
            { std::lock_guard<std::mutex> lock(cerrMutex);
              std::cerr << "[[PIN_VALUE:" << pin << ":" << value << "]]" << std::endl;
              std::cerr.flush(); }
        }
        trackIOOperation(pin, "digitalWrite");
    }
}

int digitalRead(int pin) { 
    if (pin >= 0 && pin < 20) {
        int val = pinValues[pin].load(std::memory_order_seq_cst);
        trackIOOperation(pin, "digitalRead");
        return val;
    }
    return LOW; 
}

void analogWrite(int pin, int value) {
    if (pin >= 0 && pin < 20) {
        int oldValue = pinValues[pin].load(std::memory_order_seq_cst);
        pinValues[pin].store(value, std::memory_order_seq_cst);
        // Only send update if value actually changed
        if (oldValue != value) {
            { std::lock_guard<std::mutex> lock(cerrMutex);
              std::cerr << "[[PIN_PWM:" << pin << ":" << value << "]]" << std::endl; }
        }
        trackIOOperation(pin, "analogWrite");
    }
}

int analogRead(int pin) {
    // Support both analog channel numbers 0..5 and A0..A5 (14..19)
    int p = pin;
    if (pin >= 0 && pin <= 5) p = 14 + pin; // map channel 0..5 to A0..A5
    if (p >= 0 && p < 20) {
        trackIOOperation(p, "analogRead");
        // Return the externally-set pin value (0..1023 expected for analog inputs)
        return pinValues[p].load(std::memory_order_seq_cst);
    }
    return 0;
}
`;
