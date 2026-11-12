import { useEffect, useState } from 'react';
import type { StatuslineStatus } from '@shared/types';
import { BUTTON, CTA } from '../components/ui';
import { readable } from '../errors';

const LABEL: Record<StatuslineStatus, string> = {
  connected: 'Connected. Claude Code sessions report to Ark.',
  disconnected: 'Not connected.',
  bypassed: 'Disconnected: your status line was changed after Ark connected. Connect again to include it.',
};

export function StatuslineSection() {
  const [status, setStatus] = useState<StatuslineStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    window.ark.statusline.status().then(setStatus);
  }, []);
  const act = async (fn: () => Promise<StatuslineStatus>) => {
    setError(null);
    try {
      setStatus(await fn());
    } catch (e) {
      // e.g. settings.json isn't valid JSON: Ark refuses before writing anything.
      setError(`Nothing was changed. ${readable(e)}`);
    }
  };
  return (
    <>
      <div className="flex flex-col gap-2">
        <p>
          Claude Code shares context and usage limits through its status line. To read them, Ark changes the statusLine
          entry in ~/.claude/settings.json so that it runs a small Ark script first.
        </p>
        <p>
          Your current status line keeps running exactly as before. Ark backs up settings.json before changing it, and
          Disconnect puts the original entry back.
        </p>
        <p className="text-muted">Projects with their own statusLine in .claude/settings*.json won&apos;t report to Ark.</p>
      </div>
      {status && <p className="text-secondary">{LABEL[status]}</p>}
      {error && <p role="alert" className="text-secondary">{error}</p>}
      <div className="flex gap-1">
        {status !== null && status !== 'connected' && (
          <button onClick={() => act(window.ark.statusline.connect)} className={CTA}>Connect status line</button>
        )}
        {status === 'connected' && (
          <button onClick={() => act(window.ark.statusline.disconnect)} className={BUTTON}>Disconnect</button>
        )}
      </div>
    </>
  );
}
