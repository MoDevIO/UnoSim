// Braces, semicolons and keywords in text are not structure; each size check fails if a byte moves.
const char klammer[] = "{ if (x) ; } else {";
static_assert(sizeof(klammer) == 20, "string");
const char zeichen = '{';
const char roh[] = R"x(
  if (a) {
    }
)x";
static_assert(sizeof(roh) == 19, "raw string");
const char quote[] = R"q"(a
{payload}
)q"";
static_assert(sizeof(quote) == 13, "raw string with a quote in its delimiter");
const char fortgesetzt[] = "eins \
{ zwei";
static_assert(sizeof(fortgesetzt) == 12, "string continued by a splice");
// } else { \
   continued comment with a brace {
/* } */ #define BLOCK(x) do { x; } while (0)
#define MEHRZEILIG(a) \
  { a; }
int f(int x) {
if (x == '}')
BLOCK(x++);
else
MEHRZEILIG(x--)
return x + zeichen;}
int main(){return f(1);}
