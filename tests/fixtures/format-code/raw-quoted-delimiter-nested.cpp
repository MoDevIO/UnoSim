void f(){
const char* s = R"q"(a
{payload}
)q"";
static_assert(sizeof(R"q"(a
{payload}
)q"") == 13, "raw string size");
}
int main(){return 0;}
