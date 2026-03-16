/**
 * Arduino Stdin Command Handler — extracted from arduino-mock.ts
 *
 * Exports the C++ code for reading and dispatching stdin protocol commands:
 *  - [[SET_PIN:X:Y]] — sets a pin value externally
 *  - [[PAUSE_TIME]] / [[RESUME_TIME:N]] — freeze/unfreeze the time counter
 *  - Normal serial input is forwarded to Serial.mockInput()
 *
 * Dependencies (must appear earlier in the assembled C++ source):
 *  - `cerrMutex`, `processIsPaused`, `pausedTimeMs`, `totalPausedTimeMs` (ARDUINO_GLOBALS)
 *  - `pinValues[]` (ARDUINO_PIN_STATE_INIT)
 *  - `millis()` (ARDUINO_TIMING_AND_RANDOM)
 *  - `Serial` global instance (ARDUINO_SERIAL_CLASS)
 *  - `keepReading` (ARDUINO_GLOBALS)
 */

export const ARDUINO_STDIN_HANDLER = String.raw`
// Global buffer for stdin reading (used by checkStdinForPinCommands)
static char stdinBuffer[256];
static size_t stdinBufPos = 0;

// Helper function to set pin value from external input
void setExternalPinValue(int pin, int value) {
    if (pin >= 0 && pin < 20) {
        pinValues[pin].store(value, std::memory_order_seq_cst);
        // Send pin state update so UI reflects the change
        { std::lock_guard<std::mutex> lock(cerrMutex);
          std::cerr << "[[PIN_VALUE:" << pin << ":" << value << "]]" << std::endl; }
    }
}

// Helper functions for pause/resume timing
void handlePauseTimeCommand() {
    // compute current time while still running; only then flip pause flag
    unsigned long currentMs = millis();  // Get current time before freezing
    pausedTimeMs.store(currentMs);
    processIsPaused.store(true);
    { std::lock_guard<std::mutex> lock(cerrMutex);
      std::cerr << "[[TIME_FROZEN:" << currentMs << "]]" << std::endl; }
}

void handleResumeTimeCommand(unsigned long pauseDurationMs) {
    processIsPaused.store(false);
    // Accumulate total paused time so micros()/millis() can subtract it
    totalPausedTimeMs += pauseDurationMs;
    { std::lock_guard<std::mutex> lock(cerrMutex);
      std::cerr << "[[TIME_RESUMED:" << totalPausedTimeMs << "]]" << std::endl; }
}

// Non-blocking check for stdin pin commands - called from delay() and txDelay()
void checkStdinForPinCommands() {
    fd_set readfds;
    struct timeval tv;
    
    while (true) {
        FD_ZERO(&readfds);
        FD_SET(STDIN_FILENO, &readfds);
        tv.tv_sec = 0;
        tv.tv_usec = 0; // Zero timeout = immediate return
        
        int selectResult = select(STDIN_FILENO + 1, &readfds, NULL, NULL, &tv);
        
        if (selectResult <= 0 || !FD_ISSET(STDIN_FILENO, &readfds)) {
            break;
        }
        
        // Read one byte
        char c;
        ssize_t n = read(STDIN_FILENO, &c, 1);
        if (n <= 0) break;
        
        if (c == '\n' || c == '\r') {
            // End of line - process buffer
            if (stdinBufPos > 0) {
                stdinBuffer[stdinBufPos] = '\0';
                
                // Check for pause/resume commands
                if (sscanf(stdinBuffer, "[[PAUSE_TIME]]") == 0 && 
                    strncmp(stdinBuffer, "[[PAUSE_TIME]]", 14) == 0) {
                    handlePauseTimeCommand();
                } else {
                    // Check for resume time with duration parameter
                    unsigned long pauseDurationMs;
                    if (sscanf(stdinBuffer, "[[RESUME_TIME:%lu]]", &pauseDurationMs) == 1) {
                        handleResumeTimeCommand(pauseDurationMs);
                    } else {
                        // Check for special pin value command: [[SET_PIN:X:Y]]
                        int pin, value;
                        if (sscanf(stdinBuffer, "[[SET_PIN:%d:%d]]", &pin, &value) == 2) {
                            setExternalPinValue(pin, value);
                        } else {
                            // Normal serial input (add newline back for serial input)
                            Serial.mockInput(stdinBuffer, stdinBufPos);
                            char newline = 10;
                            Serial.mockInput(&newline, 1);
                        }
                    }
                }
                stdinBufPos = 0;
            }
        } else if (stdinBufPos < sizeof(stdinBuffer) - 1) {
            stdinBuffer[stdinBufPos++] = c;
        }
    }
}

// Thread-based reader for when main thread is not in delay/serial (legacy, still useful)
void serialInputReader() {
    while (keepReading.load()) {
        checkStdinForPinCommands();
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
}
`;
