/**
 * Platform detection utilities
 */

/**
 * Detects if the current platform is macOS
 */
export const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/**
 * Detects if the current platform is Windows
 */
export const isWindows = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('WIN');

/**
 * Detects if the current platform is Linux
 */
export const isLinux = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('LINUX');
