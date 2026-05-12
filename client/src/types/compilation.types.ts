/**
 * Client-side compilation and UI state types.
 *
 * These are UI/client-only types that describe the compilation lifecycle
 * and output panel state. Not shared with the server.
 */

/** Overall compilation lifecycle state. */
export type CompilationStatus = "ready" | "compiling" | "success" | "error";

/** Result type after a compilation attempt completes. */
export type CompilationResultType = "success" | "error" | null;

/** Active tab in the output panel. */
export type OutputTab = "compiler" | "messages" | "registry" | "debug";
