// Shared Arduino-related type aliases for better consistency across the codebase.

/**
 * Pin mode values used by the simulator and parser.
 *
 * This type is intentionally aligned with the Arduino API: "INPUT" | "OUTPUT" | "INPUT_PULLUP".
 * Using a shared type ensures consistent typings and reduces redundant union literals.
 */
export type PinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";
