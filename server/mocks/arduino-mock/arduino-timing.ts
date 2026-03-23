/**
 * Arduino Runtime Globals and Timing — extracted from arduino-mock.ts
 *
 * ARDUINO_GLOBALS: global variable declarations that must appear before all other
 *   code sections in the assembled C++ source (after #includes + ARDUINO_CONSTANTS_CODE).
 *   Includes the forward declaration of checkStdinForPinCommands().
 *
 * ARDUINO_TIMING_AND_RANDOM: timing functions (delayMicroseconds, millis, micros)
 *   and random number utilities. Depends on the globals declared in ARDUINO_GLOBALS.
 */

export const ARDUINO_GLOBALS = `
// Random number generator (for runner)
static std::mt19937 rng(std::time(nullptr));

std::atomic<bool> keepReading(true);

// Global mutex for all std::cerr writes.
// The background serialInputReader thread and the main loop thread both write
// protocol messages to stderr.  Chained << operations are NOT atomic, so without
// this mutex the two threads can interleave output and corrupt protocol framing.
static std::mutex cerrMutex;

// Pause/Resume timing state
static std::atomic<bool> processIsPaused(false);
static std::atomic<unsigned long> pausedTimeMs(0);
static auto processStartTime = std::chrono::steady_clock::now();
// accumulated duration (ms) of all pauses — subtract when calculating elapsed time
static unsigned long totalPausedTimeMs = 0;

// Forward declaration
void checkStdinForPinCommands();
`;

export const ARDUINO_TIMING_AND_RANDOM = `
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
    
    // Subtract total paused time that has been accumulated
    return static_cast<unsigned long>(elapsed) - totalPausedTimeMs;
}

unsigned long micros() {
    // If paused, return the frozen time value (in microseconds)
    if (processIsPaused.load()) {
        // pausedTimeMs is stored in milliseconds, convert once
        return pausedTimeMs.load() * 1000UL;
    }
    
    // Normal operation: calculate elapsed time since start
    auto now = std::chrono::steady_clock::now();
    auto elapsed = std::chrono::duration_cast<std::chrono::microseconds>(
        now - processStartTime
    ).count();
    
    // Subtract total paused time (converted to µs)
    return static_cast<unsigned long>(elapsed) - (totalPausedTimeMs * 1000UL);
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
`;
