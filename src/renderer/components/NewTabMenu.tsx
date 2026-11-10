import { useEffect, useState } from 'react';
import type { RootRef } from '@shared/files';
import type { ShellOption } from '@shared/terminal';
import { openBrowser } from '../browser/browser-store';
import { create, shells } from '../terminal/terms-store';
import { GlobeIcon, TerminalIcon } from './Icons';
import { Menu, type MenuItem } from './Menu';

/** The workspace's + menu, composed from the same actions as the terminal panel and browser. */
export function NewTabMenu({ projectId, root, terminal, at, onClose }: {
  projectId: string;
  root: RootRef;
  terminal: { open: boolean; onToggle: () => void };
  at: { x: number; y: number };
  onClose: () => void;
}) {
  const [options, setOptions] = useState<ShellOption[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    void shells().then(
      (list) => { if (alive) setOptions(list); },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, []);
  const items: MenuItem[] = options
    ? options.map((shell) => ({ label: `New terminal: ${shell.name}`, icon: <TerminalIcon />, onClick: () => void create(projectId, root, shell) }))
    : [{ label: failed ? 'Terminal shells unavailable' : 'Loading terminals...', icon: <TerminalIcon /> }];
  items.push(
    { label: 'New browser tab', icon: <GlobeIcon />, separator: true, onClick: () => void openBrowser(projectId) },
    { label: terminal.open ? 'Hide terminal' : 'Show terminal', icon: <TerminalIcon />, separator: true, shortcut: 'Ctrl+`', onClick: terminal.onToggle },
  );
  return <Menu items={items} at={at} onClose={onClose} label="New tab" searchPlaceholder="Search actions..." />;
}
