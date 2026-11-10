// Block comments whose delimiters a backslash-newline splits (review of 01243d588): the text inside would
// not compile, so a delimiter broken by blanks fails the build.
int main(){
int x = 0;
/\
* if(1){ broken code; } */
x++;
/* comment *\
/
x++;
/* eins \
   zwei {
   drei } */
return x;
}
