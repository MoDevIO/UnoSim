/**
 * The control a dialog returns the focus to. A menu item closes with its menu,
 * so it stands for the trigger that opened that menu.
 */
export function focusReturnTarget(element: Element | null): HTMLElement | null {
  if (!(element instanceof HTMLElement) || element === element.ownerDocument.body) return null;
  if (element.getAttribute("role") !== "menuitem") return element;
  const triggerId = element.closest("[role=menu]")?.getAttribute("aria-labelledby");
  return triggerId ? element.ownerDocument.getElementById(triggerId) : null;
}
