/** Locale-independent UTF-16 code-unit ordering for reproducible serialized output. */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
