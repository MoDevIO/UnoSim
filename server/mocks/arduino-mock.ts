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

// Random number generator (für Runner)
static std::mt19937 rng(std::time(nullptr));

std::atomic<bool> keepReading(true);

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

// GPIO Functions (suppress unused parameter warnings)
void pinMode(int, int) {}
void digitalWrite(int, int) {}
int digitalRead(int) { return LOW; }
void analogWrite(int, int) {}
int analogRead(int) { return 0; }

// Timing Functions
void delay(unsigned long ms) { 
    std::this_thread::sleep_for(std::chrono::milliseconds(ms)); 
}
void delayMicroseconds(unsigned int us) { 
    std::this_thread::sleep_for(std::chrono::microseconds(us)); 
}
unsigned long millis() { 
    static auto start = std::chrono::steady_clock::now();
    auto now = std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::milliseconds>(now - start).count();
}
unsigned long micros() {
    static auto start = std::chrono::steady_clock::now();
    auto now = std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::microseconds>(now - start).count();
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
public:
    SerialClass() {
        std::cout.setf(std::ios::unitbuf);
        std::cerr.setf(std::ios::unitbuf);
    }
    
    // Fix for 'while (!Serial)' error
    explicit operator bool() const {
        return true; // The serial connection is always considered 'ready' in the mock
    }
    
    void begin(long) {}
    void begin(long, int) {}
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
        std::cout << std::flush;
    }
    
    // Helper for number format conversion
    void printNumber(long n, int base) {
        if (base == DEC) {
            std::cout << n;
        } else if (base == HEX) {
            std::cout << std::hex << n << std::dec;
        } else if (base == OCT) {
            std::cout << std::oct << n << std::dec;
        } else if (base == BIN) {
            if (n == 0) { std::cout << "0"; }
            else {
                std::string binary;
                unsigned long un = (n < 0) ? (unsigned long)n : n;
                while (un > 0) {
                    binary = ((un & 1) ? "1" : "0") + binary;
                    un >>= 1;
                }
                std::cout << binary;
            }
        }
        std::cout << std::flush;
    }
    
    template<typename T> void print(T v) { 
        std::cout << v << std::flush; 
    }
    
    // Spezielle Überladung für byte/uint8_t (wird sonst als char ausgegeben)
    // Note: byte = uint8_t = unsigned char, daher nur EINE Überladung nötig
    void print(byte v) { std::cout << (int)v << std::flush; }
    
    // print with base format (DEC, HEX, OCT, BIN)
    void print(int v, int base) { printNumber(v, base); }
    void print(long v, int base) { printNumber(v, base); }
    void print(unsigned int v, int base) { printNumber(v, base); }
    void print(unsigned long v, int base) { printNumber(v, base); }
    void print(byte v, int base) { printNumber(v, base); }
    
    // Überladung für Floating-Point mit Dezimalstellen
    void print(float v, int decimals) {
        std::cout << std::fixed << std::setprecision(decimals) << v << std::flush;
        std::cout.unsetf(std::ios::fixed);
    }
    
    void print(double v, int decimals) {
        std::cout << std::fixed << std::setprecision(decimals) << v << std::flush;
        std::cout.unsetf(std::ios::fixed);
    }

    template<typename T> void println(T v) { 
        std::cout << v << std::endl << std::flush; 
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    
    // Spezielle Überladung für byte/uint8_t (wird sonst als char ausgegeben)
    // Note: byte = uint8_t = unsigned char, daher nur EINE Überladung nötig
    void println(byte v) { 
        std::cout << (int)v << std::endl << std::flush;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    
    // println with base format (DEC, HEX, OCT, BIN)
    void println(int v, int base) { printNumber(v, base); std::cout << std::endl; }
    void println(long v, int base) { printNumber(v, base); std::cout << std::endl; }
    void println(unsigned int v, int base) { printNumber(v, base); std::cout << std::endl; }
    void println(unsigned long v, int base) { printNumber(v, base); std::cout << std::endl; }
    void println(byte v, int base) { printNumber(v, base); std::cout << std::endl; }
    
    // Überladung für Floating-Point mit Dezimalstellen
    void println(float v, int decimals) {
        std::cout << std::fixed << std::setprecision(decimals) << v << std::endl << std::flush;
        std::cout.unsetf(std::ios::fixed);
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    
    void println(double v, int decimals) {
        std::cout << std::fixed << std::setprecision(decimals) << v << std::endl << std::flush;
        std::cout.unsetf(std::ios::fixed);
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    
    void println() { 
        std::cout << std::endl << std::flush; 
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
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


void serialInputReader() {
    constexpr size_t bufferSize = 128;
    char buffer[bufferSize];

    while (keepReading.load()) {
        if (fgets(buffer, bufferSize, stdin) != nullptr) {
            size_t len = strlen(buffer);
            Serial.mockInput(buffer, len);
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
        }
    }
}
`;

export const ARDUINO_MOCK_CODE_MINIMAL = ARDUINO_MOCK_CODE;