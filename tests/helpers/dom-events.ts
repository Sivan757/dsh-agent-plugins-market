/**
 * Drive form controls the way a browser does.
 *
 * React installs its own `value` property on every mounted input, textarea and
 * select, recording what it last rendered. Assigning `.value` through that
 * accessor updates React's record too, so the `input`/`change` event that
 * follows looks like "nothing changed" and `onChange` never runs. Writing
 * through the prototype's native setter leaves React's record stale, which is
 * what makes the dispatched event a real edit.
 */
function setNativeValue(element: Element, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
  if (descriptor?.set === undefined) throw new Error(`${element.tagName.toLowerCase()} has no native value setter`)
  // The accessor has to run against the element, so it stays attached to its receiver.
  descriptor.set.call(element, value)
}

/** Edit a text field or textarea and fire the `input` event React's `onChange` listens to. */
export function typeInto(control: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  setNativeValue(control, value)
  control.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Pick a `<select>` option and fire the `change` event React's `onChange` listens to. */
export function selectOption(select: HTMLSelectElement, value: string): void {
  setNativeValue(select, value)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}
