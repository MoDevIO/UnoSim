// Keywords and braces split by a backslash-newline are read by their joined spelling (review H3).
static volatile int n;
void f(int a)\
{
if\
(a)
n = 1;
else
n = 2;
wh\
ile (a > 3)
a--;
}
int main(){f(1); return n;}
