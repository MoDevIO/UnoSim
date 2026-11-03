/**
 * event-utils.ts
 * Type-safe custom event handler utilities
 * 
 * Eliminates the need for `as EventListener` casts by providing generically typed
 * event attachment and removal functions for custom events.
 */

/**
 * Attach a typed custom event listener to a target element
 * 
 * @template T The type of the custom event detail
 * @param target The DOM element to attach the listener to
 * @param eventName The name of the custom event
 * @param handler The callback function that receives the custom event
 */
export function onCustomEvent<T = any>(
  target: EventTarget | null | undefined,
  eventName: string,
  handler: (event: CustomEvent<T>) => void,
): void {
  if (target) {
    target.addEventListener(eventName, handler as EventListener);
  }
}

/**
 * Remove a typed custom event listener from a target element
 * 
 * @template T The type of the custom event detail
 * @param target The DOM element to remove the listener from
 * @param eventName The name of the custom event
 * @param handler The callback function to remove
 */
export function offCustomEvent<T = any>(
  target: EventTarget | null | undefined,
  eventName: string,
  handler: (event: CustomEvent<T>) => void,
): void {
  if (target) {
    target.removeEventListener(eventName, handler as EventListener);
  }
}
