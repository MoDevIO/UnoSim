#include <Arduino.h>
#include "SerialTable_Uno.h"

void setup()
{
    Serial.begin(115200);

    // Beim Uno bewusst uint8_t statt int verwenden:
    // 8 Spalten brauchen damit nur 8 Byte fuer die Breiten.
    const char *headers[] = {
        "Vorname", "Nachname", "Alter", "Stadt",
        "Beruf", "Unternehmen", "Hobby", "Bemerkung"
    };

    const uint8_t columnWidths[] = {10, 15, 5, 10, 10, 15, 10, 20};

    SerialTable table(headers, columnWidths, 8, true, true);
    table.printHeader();

    // Die Zeilen werden einzeln ausgegeben. So liegt nicht die komplette
    // 20x8-Pointer-Tabelle gleichzeitig im knappen SRAM des Uno.
    const char *row1[]  = {"Alice", "Wonderland", "30", "Koeln", "Ingenieur", "FirmaX", "Schwimmen", "Keine"};
    const char *row2[]  = {"Bob", "Builder\nJr", "35", "Berlin", "Architekt", "Architektur AG", "Bauen", "Sehr erfahren"};
    const char *row3[]  = {"Charlie", "Brown", "28", "Hamburg", "Designer", "Die Design", "Zeichnen", "Mag Karikaturen"};
    const char *row4[]  = {"David", "Tennant", "40", "Muenchen", "Schauspieler", "Freiberufler", "Lesen", "Doktor gewesen"};
    const char *row5[]  = {"Emma", "Watson", "33", "Frankfurt", "Schauspielerin", "Independent", "Yoga", "Bekannt aus Filmen"};
    const char *row6[]  = {"Frank", "Herbert", "45", "Stuttgart", "Autor", "Ein Verlag", "Schreiben", "Buecher geschrieben"};
    const char *row7[]  = {"Grace", "Hopper", "50", "Berlin", "Programmiererin", "Tech Corp", "Informatik", "Pionierin"};
    const char *row8[]  = {"Hugo", "Strange", "60", "Leipzig", "Psychiater", "Gesundheits GmbH", "Philosophie", "Ruhestand"};
    const char *row9[]  = {"Irene", "Adler", "29", "Dresden", "Detektivin", "Privat", "Abenteuer", "Scharfsinnig"};
    const char *row10[] = {"John", "Doe", "49", "Bremen", "Buchhalter", "Kontorechner", "Radfahren", "Gewissenhaft"};

    table.printRow(row1);
    table.printRow(row2);
    table.printRow(row3);
    table.printRow(row4);
    table.printRow(row5);
    table.printRow(row6);
    table.printRow(row7);
    table.printRow(row8);
    table.printRow(row9);
    table.printRow(row10);
}

void loop()
{
    // Keine zyklische Aktion erforderlich.
}
