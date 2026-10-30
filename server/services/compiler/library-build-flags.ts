/**
 * The only build property a compile may set (SSOT Libraries §10): `__FILE__`
 * names the sketch `sketch.ino`, so library macros such as AUnit's assertions
 * print no host or container path. avr-gcc 7.3 has no -fmacro-prefix-map.
 */
export const SKETCH_FILE_MACRO_PROPERTY = 'compiler.cpp.extra_flags=-Wno-builtin-macro-redefined -D__FILE__="sketch.ino"';
