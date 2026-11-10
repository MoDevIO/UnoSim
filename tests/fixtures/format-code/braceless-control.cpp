// Unformatted on purpose: Format Code must indent it without changing what it compiles to.
static int zahl = 7;
static volatile int ausgabe;
static void melde(int wert) { ausgabe = wert; }
int pruefe(int eingabe, int a, int b) {
int summe = 0;
if (eingabe == zahl)
melde(1);
else
melde(2);
if (a)
if (b)
summe += 1;
else
summe += 2;
else if (a > b &&
b > 0)
// mehrzeilige Bedingung
summe += 3;
else
summe += 4;
for (int i = 0; i < 3; i++)
while (summe > 10)
summe--;
do
summe++;
while (summe < 5);
do {
summe += 2;
} while (summe < 9);
switch (eingabe) {
case 1: {
summe += 10;
break;
}
case 2:
summe += 20;
break;
default:
summe += 30;
}
int werte[] = {1, 2,
3};
return summe + werte[2];}
int main(){return pruefe(7, 1, 0);}
