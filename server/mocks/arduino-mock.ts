/**
 * Shared Arduino Mock code for Compiler and Runner
 * * Differences between Compiler and Runner:
 * - Compiler: Only needs type definitions for syntax check (no implementation needed)
 * - Runner: Needs working implementations for real execution
 * * This file contains the complete Runner version that also works for Compiler.
 * * --- UPDATES ---
 * 1. String class: Added concat(char c) and a constructor for char to support char appending.
 * 2. SerialClass: Added explicit operator bool() to fix 'while (!Serial)' error.
 * 3. SerialClass: Implemented readStringUntil(char terminator).
 * 4. SerialClass: Added print/println overloads with decimals parameter for float/double.
 * 5. SerialClass: Added parseFloat(), readString(), setTimeout(), write(buf,len), readBytes(), readBytesUntil()
 * 6. SerialClass: Added print/println with format (DEC, HEX, OCT, BIN)
 */

export const ARDUINO_MOCK_LINES = 353; // Updated line count

export const ARDUINO_MOCK_CODE = `
// Simulated Arduino environment
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

// Random number generator (for runner)
static std::mt19937 rng(std::time(nullptr));

std::atomic<bool> keepReading(true);

// Pause/Resume timing state
static std::atomic<bool> processIsPaused(false);
static std::atomic<unsigned long> pausedTimeMs(0);
static auto processStartTime = std::chrono::steady_clock::now();
static unsigned long pauseTimeOffset = 0;

// Forward declaration
void checkStdinForPinCommands();

// Arduino String class
class String {
private:
    std::string str;
public:
    String() {}
    String(const char* s) : str(s) {}
    String(std::string s) : str(s) {}
    String(char c) : str(1, c) {} // New: Constructor from char
    String(int i) : str(std::to_string(i)) {}
    String(long l) : str(std::to_string(l)) {}
    String(float f) : str(std::to_string(f)) {}
    String(double d) : str(std::to_string(d)) {}
    
    const char* c_str() const { return str.c_str(); }
    int length() const { return str.length(); }
    char charAt(int i) const { return (size_t)i < str.length() ? str[i] : 0; }
    void concat(String s) { str += s.str; }
    void concat(const char* s) { str += s; }
    void concat(int i) { str += std::to_string(i); }
    void concat(char c) { str += c; } // New: Concat char
    int indexOf(char c) const { return str.find(c); }
    int indexOf(String s) const { return str.find(s.str); }
    String substring(int start) const { return String(str.substr(start).c_str()); }
    String substring(int start, int end) const { return String(str.substr(start, end-start).c_str()); }
    void replace(String from, String to) {
        size_t pos = 0;
        while ((pos = str.find(from.str, pos)) != std::string::npos) {
            str.replace(pos, from.str.length(), to.str);
            pos += to.str.length();
        }
    }
    void toLowerCase() { for(auto& c : str) c = std::tolower(c); }
    void toUpperCase() { for(auto& c : str) c = std::toupper(c); }
    void trim() {
        str.erase(0, str.find_first_not_of(" \\t\\n\\r"));
        str.erase(str.find_last_not_of(" \\t\\n\\r") + 1);
    }
    int toInt() const { return std::stoi(str); }
    float toFloat() const { return std::stof(str); }
    
    String operator+(const String& other) const { return String((str + other.str).c_str()); }
    String operator+(const char* other) const { return String((str + other).c_str()); }
    bool operator==(const String& other) const { return str == other.str; }
    
    friend std::ostream& operator<<(std::ostream& os, const String& s) {
        return os << s.str;
    }
};

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
        std::cerr << "[[PIN_MODE:" << pin << ":" << mode << "]]" << std::endl;
        
        // Track in I/O Registry - add pinMode as an operation with mode info
        if (ioRegistry.find(pin) != ioRegistry.end()) {
            ioRegistry[pin].defined = true;
            ioRegistry[pin].definedLine = 0; // Line number not available at runtime
            ioRegistry[pin].pinMode = mode; // Keep the pinMode field updated for backwards compatibility
            
            // Track pinMode in operations (format: "pinMode:MODE" where MODE is 0=INPUT, 1=OUTPUT, 2=INPUT_PULLUP)
            std::string pinModeOp = "pinMode:" + std::to_string(mode);
            ioRegistry[pin].operations.push_back({0, pinModeOp});
            
            // Output updated registry immediately when pinMode called
            outputIORegistry();
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
            outputIORegistry();
        }
    }
}

void digitalWrite(int pin, int value) {
    if (pin >= 0 && pin < 20) {
        int oldValue = pinValues[pin].load(std::memory_order_seq_cst);
        pinValues[pin].store(value, std::memory_order_seq_cst);
        // Only send update if value actually changed (avoid stderr flooding)
        if (oldValue != value) {
            std::cerr << "[[PIN_VALUE:" << pin << ":" << value << "]]" << std::endl;
            std::cerr.flush(); // Force immediate flush for fast updates
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
            std::cerr << "[[PIN_PWM:" << pin << ":" << value << "]]" << std::endl;
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

// Timing Functions - with pause/resume support
void delayMicroseconds(unsigned int us) { 
    std::this_thread::sleep_for(std::chrono::microseconds(us)); 
}

unsigned long millis() { 
    // If paused, return the frozen time value
    if (processIsPaused.load()) {
        return pausedTimeMs.load();
    }
    
    // Normal operation: calculate elapsed time since start
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
        now - processStartTime
    ).count();
    
    // Subtract any pause offsets that have been accumulated
    return static_cast<unsigned long>(elapsed) - pauseTimeOffset;
}

unsigned long micros() {
    // If paused, return the frozen time value (in microseconds)
    if (processIsPaused.load()) {
        return pausedTimeMs.load() * 1000UL;
    }
    
    // Normal operation: calculate elapsed time since start
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        now - processStartTime
    ).count();
    
    // Subtract any pause offsets that have been accumulated
    return static_cast<unsigned long>(elapsed) - (pauseTimeOffset * 1000UL);
}

// Random Functions
void randomSeed(unsigned long seed) {
    rng.seed(seed);
    std::srand(seed);
}
long random(long max) {
    if (max <= 0) return 0;
    std::uniform_int_distribution<long> dist(0, max - 1);
    return dist(rng);
}
long random(long min, long max) {
    if (min >= max) return min;
    std::uniform_int_distribution<long> dist(min, max - 1);
    return dist(rng);
}

// Serial class with working implementation
class SerialClass {
private:
    std::mutex mtx;
    std::queue<uint8_t> inputBuffer;
    unsigned long _timeout = 1000; // Default timeout 1 second
    bool initialized = false;
    long _baudrate = 9600;
    std::string lineBuffer; // Buffer to accumulate output until newline
    
    // Simulate serial transmission delay for n characters
    // 10 bits per char: start + 8 data + stop
    // Also checks stdin during the delay for responsiveness
    void txDelay(size_t numChars) {
        if (_baudrate > 0 && numChars > 0) {
            // Milliseconds total = (10 bits * numChars * 1000) / baudrate
            long totalMs = (10L * numChars * 1000L) / _baudrate;
            // Direct sleep (consistent with simplified delay() - no stdin polling during serial tx)
            std::this_thread::sleep_for(std::chrono::milliseconds(totalMs));
        }
    }
    
    // Base64 encoder helper
    static std::string base64_encode(const std::string &in) {
        static const std::string b64_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        std::string out;
        int val=0, valb=-6;
        for (unsigned char c : in) {
            val = (val<<8) + c;
            valb += 8;
            while (valb>=0) {
                out.push_back(b64_chars[(val>>valb)&0x3F]);
                valb-=6;
            }
        }
        if (valb>-6) out.push_back(b64_chars[((val<<8)>>(valb+8))&0x3F]);
        while (out.size()%4) out.push_back('=');
        return out;
    }

    // Flush the line buffer as a single SERIAL_EVENT
    void flushLineBuffer() {
        if (lineBuffer.empty()) return;
        unsigned long ts = millis();
        std::string enc = base64_encode(lineBuffer);
        std::cerr << "[[SERIAL_EVENT:" << ts << ":" << enc << "]]" << std::endl;
        std::cerr.flush(); // Force immediate output to Node.js
        // Simulate transmit time for the whole buffer
        txDelay(lineBuffer.length());
        lineBuffer.clear();
    }

    // Output string - buffer until newline; flush BEFORE backspace/carriage return
    // so that the control char stays with its following content
    void serialWrite(const std::string& s) {
        for (char c : s) {
            if (c == '\\b' || c == '\\r') {
                // Flush pending content BEFORE the control character
                flushLineBuffer();
                // Add backspace to buffer - it will be sent with the next char(s)
                lineBuffer += c;
            } else if (c == '\\n') {
                lineBuffer += c;
                flushLineBuffer();
            } else {
                lineBuffer += c;
            }
        }
    }
    
    void serialWrite(char c) {
        if (c == '\\b' || c == '\\r') {
            flushLineBuffer();
            lineBuffer += c;
        } else if (c == '\\n') {
            lineBuffer += c;
            flushLineBuffer();
        } else {
            lineBuffer += c;
        }
    }
    
public:
    SerialClass() {
        std::cout.setf(std::ios::unitbuf);
        std::cerr.setf(std::ios::unitbuf);
    }
    
    // Fix for 'while (!Serial)' error
    explicit operator bool() const {
        return true; // The serial connection is always considered 'ready' in the mock
    }
    
    void begin(long baud) {
        _baudrate = baud;
        if (!initialized) {
            // Disable buffering on stdout and stderr for immediate output
            setvbuf(stdout, NULL, _IONBF, 0);
            setvbuf(stderr, NULL, _IONBF, 0);
            initialized = true;
        }
    }
    void begin(long baud, int config) { begin(baud); }
    void end() {}
    
    // Set timeout for read operations (in milliseconds)
    void setTimeout(unsigned long timeout) {
        _timeout = timeout;
    }
    
    int available() {
        std::lock_guard<std::mutex> lock(mtx);
        return static_cast<int>(inputBuffer.size());
    }
    
    int read() {
        std::lock_guard<std::mutex> lock(mtx);
        if (inputBuffer.empty()) return -1;
        uint8_t b = inputBuffer.front();
        inputBuffer.pop();
        return b;
    }

    int peek() {
        std::lock_guard<std::mutex> lock(mtx);
        if (inputBuffer.empty()) return -1;
        return inputBuffer.front();
    }
    
    // Read string until terminator character
    String readStringUntil(char terminator) {
        String result;
        while (available() > 0) {
            int c = read();
            if (c == -1) break;
            if ((char)c == terminator) break;
            result.concat((char)c);
        }
        return result;
    }
    
    // Read entire string (until timeout or no more data)
    String readString() {
        String result;
        while (available() > 0) {
            int c = read();
            if (c == -1) break;
            result.concat((char)c);
        }
        return result;
    }
    
    // Read bytes into buffer, returns number of bytes read
    size_t readBytes(char* buffer, size_t length) {
        size_t count = 0;
        while (count < length && available() > 0) {
            int c = read();
            if (c == -1) break;
            buffer[count++] = (char)c;
        }
        return count;
    }
    
    // Read bytes until terminator or length reached
    size_t readBytesUntil(char terminator, char* buffer, size_t length) {
        size_t count = 0;
        while (count < length && available() > 0) {
            int c = read();
            if (c == -1) break;
            if ((char)c == terminator) break;
            buffer[count++] = (char)c;
        }
        return count;
    }

    void flush() {
        // Flush the line buffer immediately (for Serial.print without newline)
        flushLineBuffer();
        std::cout << std::flush;
    }
    
    // Helper for number format conversion - returns string
    std::string formatNumber(long n, int base) {
        std::ostringstream oss;
        if (base == DEC) {
            oss << n;
        } else if (base == HEX) {
            oss << std::hex << n << std::dec;
        } else if (base == OCT) {
            oss << std::oct << n << std::dec;
        } else if (base == BIN) {
            if (n == 0) { oss << "0"; }
            else {
                std::string binary;
                unsigned long un = (n < 0) ? (unsigned long)n : n;
                while (un > 0) {
                    binary = ((un & 1) ? "1" : "0") + binary;
                    un >>= 1;
                }
                oss << binary;
            }
        }
        return oss.str();
    }
    
    void printNumber(long n, int base) {
        serialWrite(formatNumber(n, base));
    }
    
    template<typename T> void print(T v) { 
        std::ostringstream oss;
        oss << v;
        serialWrite(oss.str());
    }
    
    // Special overload for byte/uint8_t (otherwise printed as char)
    void print(byte v) { 
        std::ostringstream oss;
        oss << (int)v;
        serialWrite(oss.str());
    }
    
    // print with base format (DEC, HEX, OCT, BIN)
    void print(int v, int base) { printNumber(v, base); }
    void print(long v, int base) { printNumber(v, base); }
    void print(unsigned int v, int base) { printNumber(v, base); }
    void print(unsigned long v, int base) { printNumber(v, base); }
    void print(byte v, int base) { printNumber(v, base); }
    
    // Overload for floating-point with decimal places
    void print(float v, int decimals) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(decimals) << v;
        serialWrite(oss.str());
    }
    
    void print(double v, int decimals) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(decimals) << v;
        serialWrite(oss.str());
    }

    template<typename T> void println(T v) { 
        std::ostringstream oss;
        oss << v << "\\n";
        serialWrite(oss.str());
    }
    
    // Special overload for byte/uint8_t (otherwise printed as char)
    void println(byte v) { 
        std::ostringstream oss;
        oss << (int)v << "\\n";
        serialWrite(oss.str());
    }
    
    // println with base format (DEC, HEX, OCT, BIN)
    void println(int v, int base) { 
        serialWrite(formatNumber(v, base) + "\\n");
    }
    void println(long v, int base) { 
        serialWrite(formatNumber(v, base) + "\\n");
    }
    void println(unsigned int v, int base) { 
        serialWrite(formatNumber(v, base) + "\\n");
    }
    void println(unsigned long v, int base) { 
        serialWrite(formatNumber(v, base) + "\\n");
    }
    void println(byte v, int base) { 
        serialWrite(formatNumber(v, base) + "\\n");
    }
    
    // Overload for floating-point with decimal places
    void println(float v, int decimals) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(decimals) << v << "\\n";
        serialWrite(oss.str());
    }
    
    void println(double v, int decimals) {
        std::ostringstream oss;
        oss << std::fixed << std::setprecision(decimals) << v << "\\n";
        serialWrite(oss.str());
    }
    
    void println() { 
        serialWrite("\\n");
    }

    // parseInt() - Reads next integer from Serial Input
    int parseInt() {
        int result = 0;
        int c;
        
        // Skip non-digit characters
        while ((c = read()) != -1) {
            if ((c >= '0' && c <= '9') || c == '-') {
                break;
            }
        }
        
        if (c == -1) return 0;
        
        boolean negative = (c == '-');
        if (!negative && c >= '0' && c <= '9') {
            result = c - '0';
        }
        
        while ((c = read()) != -1) {
            if (c >= '0' && c <= '9') {
                result = result * 10 + (c - '0');
            } else {
                break;
            }
        }
        
        return negative ? -result : result;
    }
    
    // parseFloat() - Reads next float from Serial Input
    float parseFloat() {
        float result = 0.0f;
        float fraction = 0.0f;
        float divisor = 1.0f;
        boolean negative = false;
        boolean inFraction = false;
        int c;
        
        // Skip non-digit characters (except minus and dot)
        while ((c = read()) != -1) {
            if ((c >= '0' && c <= '9') || c == '-' || c == '.') {
                break;
            }
        }
        
        if (c == -1) return 0.0f;
        
        // Handle negative sign
        if (c == '-') {
            negative = true;
            c = read();
        }
        
        // Read integer and fractional parts
        while (c != -1) {
            if (c == '.') {
                inFraction = true;
            } else if (c >= '0' && c <= '9') {
                if (inFraction) {
                    divisor *= 10.0f;
                    fraction += (c - '0') / divisor;
                } else {
                    result = result * 10.0f + (c - '0');
                }
            } else {
                break;
            }
            c = read();
        }
        
        result += fraction;
        return negative ? -result : result;
    }

    void write(uint8_t b) { std::cout << (char)b << std::flush; }
    void write(const char* str) { std::cout << str << std::flush; }
    
    // Write buffer with length
    size_t write(const uint8_t* buffer, size_t size) {
        for (size_t i = 0; i < size; i++) {
            std::cout << (char)buffer[i];
        }
        std::cout << std::flush;
        return size;
    }
    
    size_t write(const char* buffer, size_t size) {
        return write((const uint8_t*)buffer, size);
    }

    void mockInput(const char* data, size_t len) {
        std::lock_guard<std::mutex> lock(mtx);
        for (size_t i = 0; i < len; i++) {
            inputBuffer.push(static_cast<uint8_t>(data[i]));
        }
    }

    void mockInput(const std::string& data) {
        mockInput(data.c_str(), data.size());
    }
};

SerialClass Serial;

// Implementation of delay() after SerialClass is defined
inline void delay(unsigned long ms) { 
    // Flush serial buffer FIRST so output appears before the delay
    Serial.flush();
    
    // Direct sleep without chunking to avoid overhead from repeated system calls.
    // The previous implementation split into 10ms chunks and called checkStdinForPinCommands()
    // ~100 times per second, which added ~2ms per iteration (~200ms overhead for 1000ms delay).
    // Real Arduino blocks completely during delay, so this matches expected behavior.
    std::this_thread::sleep_for(std::chrono::milliseconds(ms));
}

// Global buffer for stdin reading (used by checkStdinForPinCommands)
static char stdinBuffer[256];
static size_t stdinBufPos = 0;

// Helper function to set pin value from external input
void setExternalPinValue(int pin, int value) {
    if (pin >= 0 && pin < 20) {
        pinValues[pin].store(value, std::memory_order_seq_cst);
        // Send pin state update so UI reflects the change
        std::cerr << "[[PIN_VALUE:" << pin << ":" << value << "]]" << std::endl;
    }
}

// Helper functions for pause/resume timing
void handlePauseTimeCommand() {
    processIsPaused.store(true);
    unsigned long currentMs = millis();  // Get current time before freezing
    pausedTimeMs.store(currentMs);
    std::cerr << "[[TIME_FROZEN:" << currentMs << "]]" << std::endl;
}

void handleResumeTimeCommand(unsigned long pauseDurationMs) {
    processIsPaused.store(false);
    // Adjust offset to account for the pause duration that elapsed in real time
    pauseTimeOffset += pauseDurationMs;
    std::cerr << "[[TIME_RESUMED:" << pauseTimeOffset << "]]" << std::endl;
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
        
        if (c == '\\n' || c == '\\r') {
            // End of line - process buffer
            if (stdinBufPos > 0) {
                stdinBuffer[stdinBufPos] = '\\0';
                
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

export const ARDUINO_MOCK_CODE_MINIMAL = ARDUINO_MOCK_CODE;
