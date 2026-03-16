/**
 * Global error interceptor to suppress Monaco's hitTest null reference errors
 * This module should be imported once at the application root
 */

// Debug mode
const DEBUG = false; // Disable after testing

import { Logger } from "../../../shared/logger";
const logger = new Logger("MonacoErrorSuppressor");
const log = (msg: string, ...args: unknown[]) => {
  if (DEBUG) {
    logger.debug(`[Monaco Error Suppressor] ${msg}`, ...(args as []));
  }
};

log("Module loaded");

// First, patch the global error handler used by Monaco itself
// This prevents the error from being thrown in the first place
declare global {
  interface Window {
    __MONACO_EDITOR_ERROR_HANDLER__?: {
      onUnexpectedError: (error: unknown) => void;
    };
  }
}

window.__MONACO_EDITOR_ERROR_HANDLER__ = {
  onUnexpectedError: (error: unknown) => {
    let message = "";
    let stack = "";
    
    if (error instanceof Error) {
      message = error.message;
      stack = error.stack ?? "";
    } else {
      message = String(error);
    }

    if (
      (message.includes("offsetNode") && message.includes("hitResult")) ||
      stack.includes("_doHitTestWithCaretPositionFromPoint")
    ) {
      log(
        "Intercepted Monaco internal error handler - suppressing hitTest error",
      );
      return; // Suppress by not rethrowing
    }

    // Let other errors through
    if (typeof console !== "undefined" && console.error) {
      console.error(error);
    }
  },
};

// Suppress Monaco hitTest errors globally
const originalError = console.error;
const originalWarn = console.warn;

const isMonacoHitTestError = (args: unknown[]): boolean => {
  if (args.length === 0) return false;
  
  const firstArg = args[0];
  if (!firstArg || typeof firstArg !== 'object') return false;

  let message = "";
  let stack = "";

  if (firstArg instanceof Error) {
    message = firstArg.message;
    stack = firstArg.stack ?? "";
  } else {
    message = String(firstArg);
  }

  const isError =
    (message.includes("offsetNode") && message.includes("hitResult")) ||
    stack.includes("_doHitTestWithCaretPositionFromPoint") ||
    (message.includes("can't access property") &&
      message.includes("hitResult is null"));

  if (isError) {
    log("Detected Monaco hitTest error:", {
      message: message.slice(0, 150),
    });
  }

  return isError;
};

console.error = function (...args: unknown[]) {
  if (isMonacoHitTestError(args)) {
    log("Suppressed error via console.error");
    return;
  }
  originalError.apply(console, args as any);
};

console.warn = function (...args: unknown[]) {
  if (isMonacoHitTestError(args)) {
    log("Suppressed warning via console.warn");
    return;
  }
  originalWarn.apply(console, args as any);
};

// Intercept uncaught errors at the earliest point
const originalErrorHandler = globalThis.onerror;
globalThis.onerror = function (message, source, lineno, colno, error) {
  const errorMessage = String(message) || "";
  const errorStack = error?.stack || "";

  if (
    (errorMessage.includes("offsetNode") &&
      errorMessage.includes("hitResult")) ||
    errorStack.includes("_doHitTestWithCaretPositionFromPoint")
  ) {
    log("Suppressed error via window.onerror");
    return true; // Suppress
  }

  if (originalErrorHandler) {
    return originalErrorHandler(message, source, lineno, colno, error);
  }
  return false;
};

// Capture errors before they bubble up
globalThis.addEventListener(
  "error",
  (event: ErrorEvent) => {
    if (isMonacoHitTestError([event.error])) {
      log(
        "Suppressed error via error event listener (stopImmediatePropagation)",
      );
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
  },
  true,
);

// Handle unhandled promise rejections
globalThis.addEventListener(
  "unhandledrejection",
  (event: PromiseRejectionEvent) => {
    const reason = event.reason;

    if (reason && isMonacoHitTestError([reason])) {
      log("Suppressed rejection via unhandledrejection listener");
      event.preventDefault();
    }
  },
  true,
);

// Remove error overlays if they appear (Replit's runtime error modal)
if (typeof MutationObserver !== "undefined") {
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            // Element node
            const element = node as HTMLElement;
            const textContent = element.textContent || "";
            const innerHTML = element.innerHTML || "";

            // Check if this is an error overlay/modal
            if (
              textContent.includes("offsetNode") ||
              innerHTML.includes("offsetNode") ||
              textContent.includes("_doHitTestWithCaretPositionFromPoint")
            ) {
              log("Found Monaco hitTest error overlay, removing:", {
                class: element.className,
              });
              element.remove();
            }
          }
        });
      }
    });
  });

  // Start observing when DOM is ready
  if (document.body) {
    log("Attaching MutationObserver to document.body");
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      log("Attaching MutationObserver on DOMContentLoaded");
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    });
  }
}
