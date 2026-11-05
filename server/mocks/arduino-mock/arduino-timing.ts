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

// Pause/Resume timing state, guarded by timeMutex. The runtime measures each
// pause itself: the clock freezes when it handles [[PAUSE_TIME:n]] (before the
// runner stops the process) and thaws when it handles [[RESUME_TIME:n]].
static std::mutex timeMutex;
static bool timeFrozen = false;
static unsigned long long frozenMicros = 0;
static std::chrono::steady_clock::time_point frozenAt;
static std::chrono::steady_clock::duration totalPausedTime{0};
static auto processStartTime = std::chrono::steady_clock::now();

// Forward declaration
void checkStdinForPinCommands();
`;

export const ARDUINO_TIMING_AND_RANDOM = `
// Timing Functions - with pause/resume support
void delayMicroseconds(unsigned int us) { 
    std::this_thread::sleep_for(std::chrono::microseconds(us)); 
}

// Simulated time in microseconds: real time since start minus all paused time.
// millis() and micros() share it, so they never disagree.
static unsigned long long simulatedMicros() {
    std::lock_guard<std::mutex> lock(timeMutex);
    if (timeFrozen) return frozenMicros;
    auto running = std::chrono::steady_clock::now() - processStartTime - totalPausedTime;
    return static_cast<unsigned long long>(
        std::chrono::duration_cast<std::chrono::microseconds>(running).count());
}

// Both wrap around at the width of unsigned long, like the Arduino counters.
unsigned long millis() {
    return static_cast<unsigned long>(simulatedMicros() / 1000ULL);
}

unsigned long micros() {
    return static_cast<unsigned long>(simulatedMicros());
}

// Freezes the clock at its current value; returns that value in ms.
static unsigned long freezeTime() {
    std::lock_guard<std::mutex> lock(timeMutex);
    if (!timeFrozen) {
        frozenAt = std::chrono::steady_clock::now();
        auto running = frozenAt - processStartTime - totalPausedTime;
        frozenMicros = static_cast<unsigned long long>(
            std::chrono::duration_cast<std::chrono::microseconds>(running).count());
        timeFrozen = true;
    }
    return static_cast<unsigned long>(frozenMicros / 1000ULL);
}

// Thaws the clock: it goes on from the frozen value; returns that value in ms.
static unsigned long thawTime() {
    std::lock_guard<std::mutex> lock(timeMutex);
    if (timeFrozen) {
        totalPausedTime += std::chrono::steady_clock::now() - frozenAt;
        timeFrozen = false;
    }
    return static_cast<unsigned long>(frozenMicros / 1000ULL);
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
