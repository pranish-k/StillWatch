/** Escapes one RFC 6901 reference token: `~` becomes `~0`, `/` becomes `~1`. */
export function escapePointerToken(token: string): string {
  if (!token.includes('~') && !token.includes('/')) return token;
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

/** Appends a key or array index to a JSON pointer. */
export function childPointer(parent: string, key: string | number): string {
  return `${parent}/${typeof key === 'number' ? String(key) : escapePointerToken(key)}`;
}

/**
 * Sets an own property on a plain object, including `__proto__`, without
 * touching the prototype chain.
 */
export function setOwn<V>(target: Record<string, V>, key: string, value: V): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    target[key] = value;
  }
}
