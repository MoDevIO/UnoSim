int r;
void setup()
{
}
void loop()
{
}
void rek()
{
    r++;
    delay(100);
    if (r < 10)
        rek();
}