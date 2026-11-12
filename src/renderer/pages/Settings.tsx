import { useEffect, useState, type ReactNode } from 'react';
import type { ThemeMode, ViewMode } from '@shared/types';
import { AGENT_NAME } from '../agents';
import { Page } from '../components/Page';
import { applyTheme } from '../theme';
import { StatuslineSection } from './StatuslineConnect';

/** Every Ark setting in one place. Engines and the Head of Staff stay in the agent catalog, next to the agents they configure. */

const THEMES: [ThemeMode, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
const VIEWS: ViewMode[] = ['compact', 'detailed'];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1 border-b border-divider pb-3">
      <h2 className="text-body">{title}</h2>
      {hint && <p className="text-muted">{hint}</p>}
      {children}
    </section>
  );
}

function Choice<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: [T, string][]; onPick: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="control-inset flex h-4 w-fit items-center rounded-sm bg-primary p-[2px]">
      {options.map(([v, text]) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          aria-pressed={value === v}
          className={`h-full rounded-xs px-1 text-meta ${value === v ? 'control-raised bg-raised text-secondary' : 'text-muted hover:text-secondary'}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

export function Settings() {
  const [theme, setTheme] = useState<ThemeMode>('system');
  const [view, setView] = useState<ViewMode>('compact');
  const [thresholds, setThresholds] = useState({ claude: 40, codex: 40 });
  const [error, setError] = useState('');
  useEffect(() => {
    const s = window.ark.settings;
    s.getTheme().then(setTheme, () => {});
    s.getView().then(setView, () => {});
    s.getHandoffThresholds().then(setThresholds).catch(() => setError('Could not load handoff settings.'));
  }, []);

  const pickTheme = (t: ThemeMode) => {
    setTheme(t);
    applyTheme(t);
    void window.ark.settings.setTheme(t).catch(() => setError('Could not save the theme.'));
  };
  const pickView = (v: ViewMode) => {
    setView(v);
    void window.ark.settings.setView(v).catch(() => setError('Could not save the usage view.'));
  };

  return (
    <Page title="Settings" meta={['Appearance, usage and integrations']} narrow>
      <Section title="Appearance" hint="System follows your Windows light or dark mode.">
        <Choice label="Theme" value={theme} options={THEMES} onPick={pickTheme} />
      </Section>
      <Section title="Usage view" hint="How the Usage overview lists sessions.">
        <Choice label="Usage view" value={view} options={VIEWS.map((v): [ViewMode, string] => [v, v[0].toUpperCase() + v.slice(1)])} onPick={pickView} />
      </Section>
      <Section title="Handoff" hint="Context used at the end of a thread turn. Applies to Claude and Codex planning sessions.">
        <div className="flex gap-3">
          {(['claude', 'codex'] as const).map((engine) => (
            <label key={engine} className="flex items-center gap-1">
              {AGENT_NAME[engine]}
              <input
                aria-label={AGENT_NAME[engine] + ' handoff threshold'}
                type="number" min={1} max={100} step={1}
                defaultValue={thresholds[engine]}
                key={engine + ':' + thresholds[engine]}
                className="w-6 rounded-sm bg-raised px-1 text-secondary"
                onBlur={(e) => {
                  const percent = Number(e.currentTarget.value);
                  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
                    e.currentTarget.value = String(thresholds[engine]);
                    setError('Enter a whole number from 1 to 100.');
                    return;
                  }
                  void window.ark.settings.setHandoffThreshold(engine, percent)
                    .then(() => { setThresholds((old) => ({ ...old, [engine]: percent })); setError(''); })
                    .catch(() => setError('Could not save handoff settings.'));
                }}
              />%
            </label>
          ))}
        </div>
      </Section>
      <Section title="Claude Code status line">
        <StatuslineSection />
      </Section>
      {error && <p role="alert">{error}</p>}
    </Page>
  );
}
