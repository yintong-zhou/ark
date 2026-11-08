import { expect, it, vi } from 'vitest';
import { lockDown, PARTITION } from '../../src/main/services/browser/session';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the fake takes whatever each Electron handler takes
type Fn = (...args: any[]) => any;

// Records what lockDown installs, so each handler can be called by hand.
function fakeSession() {
  const got: { request?: Fn; check?: Fn; cert?: Fn; beforeRequest?: Fn; download?: Fn; calls: number } = { calls: 0 };
  const ses = {
    setPermissionRequestHandler: (h: Fn) => ((got.request = h), got.calls++),
    setPermissionCheckHandler: (h: Fn) => ((got.check = h), got.calls++),
    setCertificateVerifyProc: (h: Fn) => ((got.cert = h), got.calls++),
    on: (event: string, h: Fn) => {
      if (event === 'will-download') got.download = h;
      got.calls++;
    },
    webRequest: { onBeforeRequest: (h: Fn) => ((got.beforeRequest = h), got.calls++) },
  };
  return { ses: ses as unknown as Electron.Session, got };
}

const cancels = (h: Fn, resourceType: string, url: string): boolean => {
  let res: { cancel?: boolean } | undefined;
  h({ resourceType, url }, (r: { cancel?: boolean }) => (res = r));
  return !!res?.cancel;
};

it('uses its own persistent partition', () => {
  expect(PARTITION).toBe('persist:ark-browser');
});

it('denies permissions and downloads, trusts local certificates only, and keeps the page local', () => {
  const { ses, got } = fakeSession();
  lockDown(ses);

  const granted = vi.fn();
  got.request!({}, 'media', granted, {});
  expect(granted).toHaveBeenCalledWith(false);
  expect(got.check!(null, 'notifications', 'http://localhost:5173', {})).toBe(false);

  const e = { preventDefault: vi.fn() };
  got.download!(e, {}, {});
  expect(e.preventDefault).toHaveBeenCalled();

  const verdict = (hostname: string) => {
    const cb = vi.fn();
    got.cert!({ hostname }, cb);
    return cb.mock.calls[0][0];
  };
  expect(verdict('localhost')).toBe(0);
  expect(verdict('example.com')).toBe(-3);

  const h = got.beforeRequest!;
  expect(cancels(h, 'subFrame', 'https://ads.example.com/')).toBe(true);
  expect(cancels(h, 'mainFrame', 'https://evil.com/')).toBe(true);
  expect(cancels(h, 'mainFrame', 'http://localhost:5173/')).toBe(false);
  expect(cancels(h, 'script', 'https://cdn.example.com/x.js')).toBe(false);
  expect(cancels(h, 'subFrame', 'http://localhost:5173/frame')).toBe(false);
});

it('locks a session once', () => {
  const { ses, got } = fakeSession();
  lockDown(ses);
  const after = got.calls;
  expect(after).toBeGreaterThan(0);
  lockDown(ses);
  expect(got.calls).toBe(after);
});
