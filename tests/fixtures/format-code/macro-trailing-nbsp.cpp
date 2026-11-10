// Review of 6a25d4706 (F5): a no-break space (U+00A0) at the end of a macro is part of its replacement text.
// Stringized, it gives two bytes more; the formatter may drop only spaces and tabs at the end of a line.
#define S_(x) #x
#define S(x) S_(x)
#define X a 
static_assert(sizeof(S(X)) == 4, "the no-break space must remain");
int main(){
if(sizeof(S(X)) == 4)
return sizeof(S(X));
return 0;}
