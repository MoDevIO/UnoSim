/**
 * Arduino Stdin Command Handler — extracted from arduino-mock.ts
 *
 * Exports the C++ code for reading and dispatching stdin protocol commands:
 *  - [[SET_PIN:X:Y]] — sets a pin value externally
 *  - [[PAUSE_TIME:N]] / [[RESUME_TIME:N]] — freeze/thaw the clock; acknowledged with
 *    [[TIME_FROZEN:N:ms]] / [[TIME_RESUMED:N:ms]] (N is the runner's pause number)
 *  - Normal serial input is forwarded to Serial.mockInput()
 *
 * Dependencies (must appear earlier in the assembled C++ source):
 *  - `cerrMutex` (ARDUINO_GLOBALS)
 *  - `pinValues[]` (ARDUINO_PIN_STATE_INIT)
 *  - `freezeTime()`, `thawTime()` (ARDUINO_TIMING_AND_RANDOM)
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

// Pause/resume timing. The runner stops the process only after [[TIME_FROZEN]].
void handlePauseTimeCommand(unsigned long pause) {
    unsigned long frozenMs = freezeTime();
    { std::lock_guard<std::mutex> lock(cerrMutex);
      std::cerr << "[[TIME_FROZEN:" << pause << ":" << frozenMs << "]]" << std::endl; }
}

void handleResumeTimeCommand(unsigned long pause) {
    unsigned long resumedMs = thawTime();
    { std::lock_guard<std::mutex> lock(cerrMutex);
      std::cerr << "[[TIME_RESUMED:" << pause << ":" << resumedMs << "]]" << std::endl; }
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
                
                unsigned long pause;
                int pin, value;
                if (sscanf(stdinBuffer, "[[PAUSE_TIME:%lu]]", &pause) == 1) {
                    handlePauseTimeCommand(pause);
                } else if (sscanf(stdinBuffer, "[[RESUME_TIME:%lu]]", &pause) == 1) {
                    handleResumeTimeCommand(pause);
                } else if (sscanf(stdinBuffer, "[[SET_PIN:%d:%d]]", &pin, &value) == 2) {
                    // Special pin value command
                    setExternalPinValue(pin, value);
                } else {
                    // Normal serial input (add newline back for serial input)
                    Serial.mockInput(stdinBuffer, stdinBufPos);
                    char newline = 10;
                    Serial.mockInput(&newline, 1);
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
