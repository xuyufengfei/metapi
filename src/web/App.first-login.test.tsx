import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import App from './App.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getEvents: vi.fn(),
    getAuthInfo: vi.fn(),
    changeAuthToken: vi.fn(),
  },
}));

vi.mock('./api.js', () => ({ api: apiMock }));
vi.mock('./components/TooltipLayer.js', () => ({ default: () => null }));
vi.mock('./components/SearchModal.js', () => ({ default: () => null }));
vi.mock('./components/NotificationPanel.js', () => ({ default: () => null }));
vi.mock('./components/MobileDrawer.js', () => ({ MobileDrawer: () => null }));
vi.mock('./pages/Dashboard.js', () => ({ default: () => null }));
vi.mock('./pages/Sites.js', () => ({ default: () => null }));
vi.mock('./pages/Accounts.js', () => ({ default: () => null }));
vi.mock('./pages/Tokens.js', () => ({ default: () => null }));
vi.mock('./pages/CheckinLog.js', () => ({ default: () => null }));
vi.mock('./pages/TokenRoutes.js', () => ({ default: () => null }));
vi.mock('./pages/ProxyLogs.js', () => ({ default: () => null }));
vi.mock('./pages/Settings.js', () => ({ default: () => null }));
vi.mock('./pages/DownstreamKeys.js', () => ({ default: () => null }));
vi.mock('./pages/ImportExport.js', () => ({ default: () => null }));
vi.mock('./pages/NotificationSettings.js', () => ({ default: () => null }));
vi.mock('./pages/ProgramLogs.js', () => ({ default: () => null }));
vi.mock('./pages/Models.js', () => ({ default: () => null }));
vi.mock('./pages/About.js', () => ({ default: () => null }));
vi.mock('./pages/ModelTester.js', () => ({ default: () => null }));
vi.mock('./pages/Monitors.js', () => ({ default: () => null }));
vi.mock('./pages/OAuthManagement.js', () => ({ default: () => null }));

function createStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => store.has(key) ? store.get(key)! : null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    dump: () => Object.fromEntries(store.entries()),
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('App first login password change flow', () => {
  let storage: ReturnType<typeof createStorage>;
  const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();

  const rememberDescriptor = (key: keyof typeof globalThis) => {
    originalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    originalDescriptors.clear();
    storage = createStorage({ auth_token: 'change-me-admin-token', auth_token_expires_at: String(Date.now() + 60_000) });

    for (const key of ['localStorage', 'Node', 'Element', 'HTMLElement', 'Text', 'MutationObserver', 'window', 'document'] as const) {
      rememberDescriptor(key);
    }

    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
    class NodeStub {}
    Object.assign(NodeStub, { TEXT_NODE: 3, ELEMENT_NODE: 1 });
    class ElementStub extends NodeStub {}
    class HTMLElementStub extends ElementStub {}
    class TextStub extends NodeStub {}
    Object.defineProperty(globalThis, 'Node', {
      value: NodeStub,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Element', {
      value: ElementStub,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'HTMLElement', {
      value: HTMLElementStub,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Text', {
      value: TextStub,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'MutationObserver', {
      value: class {
        observe() {}
        disconnect() {}
        takeRecords() { return []; }
      },
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        location: { reload: vi.fn() },
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }),
      }, configurable: true, writable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: { documentElement: { setAttribute: vi.fn() }, addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { style: {} } }, configurable: true, writable: true,
    });
    apiMock.getEvents.mockResolvedValue([]);
  });

  afterEach(() => {
    for (const [key, descriptor] of originalDescriptors.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete (globalThis as Record<PropertyKey, unknown>)[key];
      }
    }
    vi.clearAllMocks();
  });

  it('forces the user into change-token flow when requirePasswordChange is true', async () => {
    apiMock.getAuthInfo.mockResolvedValue({ requirePasswordChange: true });
    let root: ReturnType<typeof create> | null = null;
    try {
      await act(async () => {
        root = create(<MemoryRouter><App /></MemoryRouter>);
      });
      await flush();
      expect(JSON.stringify(root!.toJSON())).toContain('首次登录请修改管理员 Token');
      expect(JSON.stringify(root!.toJSON())).toContain('默认管理员 Token');
    } finally {
      root?.unmount();
    }
  });

  it('clears auth state when auth info loading reports session expired', async () => {
    apiMock.getAuthInfo.mockRejectedValue(new Error('Session expired'));
    let root: ReturnType<typeof create> | null = null;
    try {
      await act(async () => {
        root = create(<MemoryRouter><App /></MemoryRouter>);
      });
      await flush();
      expect(storage.getItem('auth_token')).toBeNull();
      expect(storage.getItem('auth_token_expires_at')).toBeNull();
      expect(JSON.stringify(root!.toJSON())).toContain('Admin Token');
      expect(JSON.stringify(root!.toJSON())).toContain('Sign In');
    } finally {
      root?.unmount();
    }
  });
});
