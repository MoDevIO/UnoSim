/**
 * Global error interceptor to suppress Monaco's hitTest null reference errors
 * This module should be imported once at the application root
 */

// Debug mode
const DEBUG = false; // Disable after testing
const log = (msg: string, ...args: any[]) => {
  if (DEBUG) {
    console.log(`[Monaco Error Suppressor] ${msg}`, ...args);
  }
};

log("Module loaded");

// First, patch the global error handler used by Monaco itself
// This prevents the error from being thrown in the first place
(window as any).__MONACO_EDITOR_ERROR_HANDLER__ = {
  onUnexpectedError: (error: any) => {
    const message = error?.message || error?.toString?.() || "";
    const stack = error?.stack || "";

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

const isMonacoHitTestError = (args: any[]) => {
  const firstArg = args[0];
  if (!firstArg) return false;

  const message = firstArg?.message || firstArg?.toString?.() || "";
  const stack = firstArg?.stack || "";

  const isError =
    (message.includes("offsetNode") && message.includes("hitResult")) ||
    stack.includes("_doHitTestWithCaretPositionFromPoint") ||
    (message.includes("can't access property") &&
      message.includes("hitResult is null"));

  if (isError) {
    log("Detected Monaco hitTest error:", {
      message: message.substring(0, 150),
    });
  }

  return isError;
};

console.error = function (...args: any[]) {
  if (isMonacoHitTestError(args)) {
    log("Suppressed error via console.error");
    return;
  }
  originalError.apply(console, args);
};

console.warn = function (...args: any[]) {
  if (isMonacoHitTestError(args)) {
    log("Suppressed warning via console.warn");
    return;
  }
  originalWarn.apply(console, args);
};

// Intercept uncaught errors at the earliest point
const originalErrorHandler = window.onerror;
window.onerror = function (message, source, lineno, colno, error) {
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
window.addEventListener(
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
window.addEventListener(
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
