import { beforeEach, describe, expect, it, vi } from 'vitest';

function createStorage() {
  const store = new Map<string, string>();

  return {
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    get length() {
      return store.size;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe('PreferenceManager cache precedence', () => {
  beforeEach(() => {
    vi.resetModules();

    const localStorage = createStorage();
    const sessionStorage = createStorage();

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorage,
    });
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: sessionStorage,
    });

    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query) => ({
        addEventListener: vi.fn(),
        addListener: vi.fn(),
        dispatchEvent: vi.fn(),
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        removeEventListener: vi.fn(),
        removeListener: vi.fn(),
      })),
    );
  });

  it('keeps override app name when cached preferences contain an older name', async () => {
    window.localStorage.setItem(
      'testNamespace-preferences',
      JSON.stringify({
        value: {
          app: {
            name: 'legacy-brand',
          },
        },
      }),
    );

    const { PreferenceManager } = await import('../src/preferences');
    const preferenceManager = new PreferenceManager();

    await preferenceManager.initPreferences({
      namespace: 'testNamespace',
      overrides: {
        app: {
          name: 'agent-brand',
        },
      },
    });

    expect(preferenceManager.getPreferences().app.name).toBe('agent-brand');
  });
});
