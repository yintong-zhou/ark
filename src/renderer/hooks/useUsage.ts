import { useCallback, useEffect, useState } from 'react';
import type { UsageState } from '@shared/types';

/** Live usage state from main, plus a clock that ticks so ages and reset times stay current. */
export function useUsage() {
  const [state, setState] = useState<UsageState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    window.ark.usage.get().then(setState);
    const off = window.ark.usage.onChanged(setState);
    const timer = setInterval(() => setNow(Date.now()), 10e3);
    return () => {
      off();
      clearInterval(timer);
    };
  }, []);
  const refresh = useCallback(async () => {
    setState(await window.ark.usage.refresh());
    setNow(Date.now());
  }, []);
  return { state, refresh, now };
}
