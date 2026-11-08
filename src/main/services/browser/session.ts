import { certVerdict, isLocalUrl } from '../../../shared/browser';

/** The browser views' own session: a dev server's login survives a restart, apart from Ark's session. */
export const PARTITION = 'persist:ark-browser';

const locked = new WeakSet<Electron.Session>();

/** No permissions, no downloads, local self-signed certificates only, and nothing non-local as a page or frame. */
export function lockDown(ses: Electron.Session): void {
  if (locked.has(ses)) return;
  locked.add(ses);
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
  ses.setCertificateVerifyProc((req, callback) => callback(certVerdict(req.hostname)));
  // The safety net behind the navigation policy; subresources (CDNs, APIs) stay allowed.
  ses.webRequest.onBeforeRequest((d, callback) =>
    callback({ cancel: (d.resourceType === 'mainFrame' || d.resourceType === 'subFrame') && !isLocalUrl(d.url) }),
  );
}
