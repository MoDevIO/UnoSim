#ifndef LEDCONTROLLER_H
#define LEDCONTROLLER_H

class LEDController
{
public:
    LEDController(byte aPin) : PIN(aPin) { pinMode(aPin, OUTPUT); };
    void switch_to(bool b) { digitalWrite(PIN, b); };
    byte read_pin_state() { return digitalRead(PIN); };
    void on() { switch_to(HIGH); };
    void off() { switch_to(LOW); };
    void toggle() { switch_to(!read_pin_state()); };

    void blink(uint16_t interval)
    {
        if ((millis() - timestamp) > interval)
        {
            digitalWrite(PIN, !digitalRead(PIN));
            timestamp = millis();
        }
    };

    void blink(uint16_t interval_off, uint16_t interval_on)
    {
        // 1. Fall: Keine Zeitintervall für den Zustand AUS-> LED ist also dauerhaft angeschaltet!
        if (interval_off==0)
            digitalWrite(PIN, HIGH);
        // 2. Fall: Keine Zeitintervall für den Zustand EIN-> LED ist also dauerhaft ausgeschaltet!
        else if (interval_on==0)
            digitalWrite(PIN, LOW);
        // 3. Fall: Es gibt Zeitintervalle EIN und AUS:
        else
            switch (digitalRead(PIN))
            {
            case HIGH:
                if ((millis() - timestamp) > interval_on)
                {
                    digitalWrite(PIN, !digitalRead(PIN));
                    timestamp = millis();
                }
                break;
            case LOW:
                if ((millis() - timestamp) > interval_off)
                {
                    digitalWrite(PIN, !digitalRead(PIN));
                    timestamp = millis();
                }
                break;
            }
    }

private:
    const byte PIN;
    uint32_t timestamp;
};

enum Chainmode
{
    LEFT,
    RIGHT,
    TOGGLE
};

class LEDChain
{
public:
    LEDChain(byte aPin_count, byte aPin_chain[], Chainmode chainmode = RIGHT) : PIN_CHAIN(aPin_chain), PIN_COUNT(aPin_count), chainmode(chainmode)
    {
        for (byte i = 0; i < aPin_count; i++)
            pinMode(aPin_chain[i], OUTPUT);
    };
    void run(uint16_t interval)
    {
        if ((millis() - timestamp) > interval)
        {
            digitalWrite(PIN_CHAIN[active_chain_index], LOW);
            timestamp = millis();
            active_chain_index = next_pin(PIN_COUNT, &direction, active_chain_index, chainmode);
        }
        else
        {
            digitalWrite(PIN_CHAIN[active_chain_index], HIGH);
        }
    }
    void set_chainmode(Chainmode cm) { chainmode = cm; };
    void on()
    {
        for (byte i = 0; i < PIN_COUNT; i++)
            digitalWrite(PIN_CHAIN[i], HIGH);
    };
    void off()
    {
        for (byte i = 0; i < PIN_COUNT; i++)
            digitalWrite(PIN_CHAIN[i], LOW);
    };

private:
    int8_t next_pin(int8_t aCount, int8_t *aDir, int8_t aIndex, Chainmode aMode)
    {
        switch (aMode)
        {
        case RIGHT:
            return (aIndex + 1) % aCount;
            break;
        case LEFT:
            if (aIndex <= 0)
                return aCount - 1;
            else
                return (aIndex - 1) % aCount;
            break;
        case TOGGLE:
            if ((aIndex <= 0) || (aIndex >= aCount - 1))
                direction *= -1;
            return aIndex + direction;
            break;
        default:
            return aIndex;
        }
    };
    const byte *PIN_CHAIN;
    const byte PIN_COUNT;
    Chainmode chainmode;
    int8_t active_chain_index = 0;
    uint32_t timestamp;
    int8_t direction = -1;
};

#endif
