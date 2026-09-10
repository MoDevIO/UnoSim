#ifndef SERIALTABLE_UNO_H
#define SERIALTABLE_UNO_H

#include <Arduino.h>
#include <string.h>

/*
 * SRAM-sparende SerialTable-Version fuer Arduino Uno / ATmega328P.
 *
 * Unterschiede zur urspruenglichen Version:
 * - keine Arduino-String-Objekte
 * - kein grosses 2D-Zwischenarray fuer alle Spalten
 * - kein malloc()/free()
 * - Ausgabe erfolgt direkt ueber Serial
 * - nur ein kleiner Zellpuffer wird verwendet
 */
class SerialTable
{
public:
    static const uint8_t MAX_CELL_SIZE = 64;

    SerialTable(const char *const headers[],
                const uint8_t columnWidths[],
                uint8_t size,
                bool doTruncateText = false,
                bool doReplaceUmlauts = false)
        : headers(headers),
          columnWidths(columnWidths),
          size(size),
          doTruncateText(doTruncateText),
          doReplaceUmlauts(doReplaceUmlauts)
    {
    }

    void printHeader()
    {
        printLine('-');
        printRowInternal(headers, '=');
    }

    void printRow(const char *const row[])
    {
        printRowInternal(row, '-');
    }

    void setDoReplaceUmlauts(bool value)
    {
        doReplaceUmlauts = value;
    }

    void setDoTruncateText(bool value)
    {
        doTruncateText = value;
    }

private:
    const char *const *headers;
    const uint8_t *columnWidths;
    uint8_t size;
    bool doTruncateText;
    bool doReplaceUmlauts;

    void printRowInternal(const char *const row[], char separator)
    {
        uint8_t maxLines = 1;
        char buffer[MAX_CELL_SIZE];

        // 1. Durchlauf: maximale Zahl sichtbarer Zeilen bestimmen.
        for (uint8_t col = 0; col < size; ++col)
        {
            prepareCell(row[col], columnWidths[col], buffer, sizeof(buffer));
            uint8_t n = countLines(buffer);
            if (n > maxLines)
                maxLines = n;
        }

        // 2. Durchlauf: jede Tabellenzeile direkt ausgeben.
        for (uint8_t line = 0; line < maxLines; ++line)
        {
            Serial.print('|');

            for (uint8_t col = 0; col < size; ++col)
            {
                prepareCell(row[col], columnWidths[col], buffer, sizeof(buffer));
                printCellLine(buffer, line, columnWidths[col]);
                Serial.print('|');
            }

            Serial.println();
        }

        printLine(separator);
    }

    void prepareCell(const char *src, uint8_t width, char *dst, size_t dstSize)
    {
        if (dstSize == 0)
            return;

        char converted[MAX_CELL_SIZE];
        copyAndReplaceUmlauts(src, converted, sizeof(converted));

        if (doTruncateText)
            truncateCell(converted, width, dst, dstSize);
        else
            wrapCell(converted, width, dst, dstSize);
    }

    void copyAndReplaceUmlauts(const char *src, char *dst, size_t dstSize)
    {
        size_t in = 0;
        size_t out = 0;

        while (src[in] != '\0' && out + 1 < dstSize)
        {
            if (doReplaceUmlauts &&
                (uint8_t)src[in] == 0xC3 && src[in + 1] != '\0')
            {
                const char *replacement = NULL;
                switch ((uint8_t)src[in + 1])
                {
                case 0xA4: replacement = "ae"; break; // ae
                case 0xB6: replacement = "oe"; break; // oe
                case 0xBC: replacement = "ue"; break; // ue
                case 0x84: replacement = "Ae"; break; // Ae
                case 0x96: replacement = "Oe"; break; // Oe
                case 0x9C: replacement = "Ue"; break; // Ue
                case 0x9F: replacement = "ss"; break; // ss
                }

                if (replacement != NULL)
                {
                    for (uint8_t r = 0; replacement[r] && out + 1 < dstSize; ++r)
                        dst[out++] = replacement[r];
                    in += 2;
                    continue;
                }
            }

            dst[out++] = src[in++];
        }

        dst[out] = '\0';
    }

    static void truncateCell(const char *src, uint8_t width, char *dst, size_t dstSize)
    {
        size_t out = 0;
        uint8_t visible = 0;
        bool truncated = false;

        // Explizite Zeilenumbrueche bleiben erhalten. Jede einzelne
        // Quellzeile wird auf die Spaltenbreite gekuerzt.
        size_t i = 0;
        while (src[i] && out + 1 < dstSize)
        {
            if (src[i] == '\n')
            {
                dst[out++] = '\n';
                ++i;
                visible = 0;
                truncated = false;
                continue;
            }

            if (visible < width)
            {
                // Bei notwendiger Kuerzung zwei Zeichen fuer ".." freihalten.
                if (!truncated && width > 2 && visible == width - 2)
                {
                    size_t look = i;
                    while (src[look] && src[look] != '\n')
                        ++look;
                    if (src[look] != '\0' || look > i + 2)
                    {
                        dst[out++] = '.';
                        if (out + 1 < dstSize)
                            dst[out++] = '.';
                        visible = width;
                        truncated = true;
                        while (src[i] && src[i] != '\n')
                            ++i;
                        continue;
                    }
                }

                dst[out++] = src[i++];
                ++visible;
            }
            else
            {
                while (src[i] && src[i] != '\n')
                    ++i;
            }
        }

        dst[out] = '\0';
    }

    static void wrapCell(const char *src, uint8_t width, char *dst, size_t dstSize)
    {
        size_t out = 0;
        uint8_t visible = 0;

        for (size_t i = 0; src[i] && out + 1 < dstSize; ++i)
        {
            char c = src[i];
            dst[out++] = c;

            if (c == '\n')
            {
                visible = 0;
                continue;
            }

            ++visible;
            if (visible >= width && src[i + 1] && src[i + 1] != '\n')
            {
                if (out + 1 < dstSize)
                    dst[out++] = '\n';
                visible = 0;
            }
        }

        dst[out] = '\0';
    }

    static uint8_t countLines(const char *text)
    {
        uint8_t lines = 1;
        for (size_t i = 0; text[i]; ++i)
            if (text[i] == '\n')
                ++lines;
        return lines;
    }

    static void printCellLine(const char *text, uint8_t wantedLine, uint8_t width)
    {
        uint8_t currentLine = 0;
        size_t i = 0;

        while (text[i] && currentLine < wantedLine)
        {
            if (text[i++] == '\n')
                ++currentLine;
        }

        uint8_t printed = 0;
        if (currentLine == wantedLine)
        {
            while (text[i] && text[i] != '\n' && printed < width)
            {
                Serial.write(text[i++]);
                ++printed;
            }
        }

        while (printed < width)
        {
            Serial.print(' ');
            ++printed;
        }
    }

    void printLine(char lineChar) const
    {
        for (uint8_t col = 0; col < size; ++col)
        {
            Serial.print('+');
            for (uint8_t j = 0; j < columnWidths[col]; ++j)
                Serial.print(lineChar);
        }
        Serial.println('+');
    }
};

#endif // SERIALTABLE_UNO_H
