import { useEffect, useState } from 'react';
import type { HistoryDay } from '@shared/types';
import { AGENT_NAME } from '../agents';
import { Page } from '../components/Page';

const pct = (v?: number) => (v === undefined ? '-' : `${Math.round(v)}%`);
const TH = 'py-1 pr-2 text-left text-meta font-normal text-muted';

export function History() {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  useEffect(() => {
    window.ark.history.get().then(setDays);
  }, []);
  return (
    <Page title="History" meta={['The last 7 days, recorded while Ark is open']}>
      <p className="max-w-[65ch] text-muted">
        Peak 5 hours is the highest reading of the day; week is the last reading of the day.
      </p>
      {days === null ? null : days.length === 0 ? (
        <p className="max-w-[65ch] text-muted">Nothing recorded yet. Keep Ark open while you work and the days fill in.</p>
      ) : (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={TH}>Day</th>
                <th className={TH}>Agent</th>
                <th className={`${TH} text-right`}>Peak 5 hours</th>
                <th className={`${TH} text-right`}>Week</th>
                <th className={`${TH} pr-0`}>Sessions, peak context</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={`${d.day}|${d.agent}`} className="border-t border-divider align-top">
                  <td className="whitespace-nowrap py-1 pr-2">{d.day}</td>
                  <td className="py-1 pr-2 text-secondary">{AGENT_NAME[d.agent]}</td>
                  <td className="py-1 pr-2 text-right">{pct(d.peakFiveHourPct)}</td>
                  <td className="py-1 pr-2 text-right">{pct(d.weeklyEndPct)}</td>
                  <td className="py-1">
                    <span className="flex flex-wrap gap-x-3">
                      {d.sessions.map((s) => (
                        <span key={s.id}>
                          {s.project || 'unknown'} <span className="text-muted">{pct(s.peakContextPct)}</span>
                        </span>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Page>
  );
}
