import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

/*
 * Node 22 defines its own `localStorage` global, which is `undefined` unless
 * the process was started with --localstorage-file. Vitest's jsdom environment
 * leaves globals that Node already defines alone, so that placeholder shadows
 * the working one jsdom provides. The app stores its tokens there, so point the
 * global back at jsdom's.
 */
function readStorage(read: () => Storage | undefined): Storage | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** A Storage that behaves like the real one, for when neither realm offers one. */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length(): number {
      return entries.size;
    },
    clear(): void {
      entries.clear();
    },
    getItem(key: string): string | null {
      return entries.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      entries.delete(key);
    },
    setItem(key: string, value: string): void {
      entries.set(key, String(value));
    },
  } as unknown as Storage;
}

function ensureStorage(key: 'localStorage' | 'sessionStorage'): void {
  if (readStorage(() => globalThis[key])) return;
  const storage = readStorage(() => window[key]) ?? createMemoryStorage();
  Object.defineProperty(globalThis, key, { value: storage, configurable: true, writable: true });
}

ensureStorage('localStorage');
ensureStorage('sessionStorage');

/*
 * React Router builds a `Request` for every navigation, passing the signal from
 * its own AbortController. jsdom provides AbortSignal but no fetch, so `Request`
 * is Node's, and Node's rejects a signal it did not create. Nothing under test
 * reads the request, so stand in for it when the two disagree.
 */
try {
  new Request('http://localhost/', { signal: new AbortController().signal });
} catch {
  class RealmSafeRequest {
    readonly url: string;
    readonly method: string;
    readonly headers: Headers;
    readonly signal: AbortSignal | undefined;
    readonly body: BodyInit | null;

    constructor(input: string | { url: string }, init: RequestInit = {}) {
      this.url = typeof input === 'string' ? input : input.url;
      this.method = init.method ?? 'GET';
      this.headers = new Headers(init.headers ?? {});
      this.signal = init.signal ?? undefined;
      this.body = init.body ?? null;
    }

    clone(): RealmSafeRequest {
      return new RealmSafeRequest(this.url, {
        method: this.method,
        headers: this.headers,
        body: this.body,
        signal: this.signal,
      });
    }
  }

  globalThis.Request = RealmSafeRequest as unknown as typeof Request;
}

afterEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// jsdom implements neither of these, and both are used by the app.
if (!('randomUUID' in crypto)) {
  Object.defineProperty(crypto, 'randomUUID', {
    value: () => '00000000-0000-4000-8000-000000000000',
  });
}

if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
}
