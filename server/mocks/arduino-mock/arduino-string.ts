/**
 * Arduino String Class Implementation
 * 
 * This file exports the C++ String class implementation that is injected
 * into the ARDUINO_MOCK_CODE template string.
 */

/**
 * Arduino String class - provides string manipulation similar to Arduino's String library
 */
export const ARDUINO_STRING_CLASS = String.raw`
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
        str.erase(0, str.find_first_not_of(" \t\n\r"));
        str.erase(str.find_last_not_of(" \t\n\r") + 1);
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
`;
