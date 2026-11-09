/** VS Code-inspired file markers, shared by the explorer, Git and editor tabs. */
export function EntryIcon({ name, folder = false, open = false }: { name: string; folder?: boolean; open?: boolean }) {
  const lower = name.toLowerCase();
  const ext = lower.split('.').pop() ?? '';
  let symbol = '';
  let color = '#c5c5c5';
  if (lower.startsWith('.git')) [symbol, color] = ['◆', '#f07755'];
  else if (lower === 'package.json' || lower === 'package-lock.json') [symbol, color] = ['⬡', '#e87979'];
  else if (lower === 'dockerfile') [symbol, color] = ['▰', '#58a6d7'];
  else if (['ts', 'js'].includes(ext)) [symbol, color] = [ext.toUpperCase(), ext === 'ts' ? '#519aba' : '#e5c07b'];
  else if (['tsx', 'jsx'].includes(ext)) [symbol, color] = ['⚛', '#61dafb'];
  else if (['json', 'jsonc'].includes(ext)) [symbol, color] = ['{}', '#e5c07b'];
  else if (ext === 'md' || ext === 'mdx') [symbol, color] = ['M↓', '#75b7d7'];
  else if (ext === 'html') [symbol, color] = ['5', '#e37933'];
  else if (['css', 'scss', 'less'].includes(ext)) [symbol, color] = ['#', ext === 'scss' ? '#ce80a6' : '#519aba'];
  else if (['yml', 'yaml', 'toml', 'ini'].includes(ext)) [symbol, color] = ['⚙', '#b7b7b7'];
  else if (ext === 'py') [symbol, color] = ['Py', '#e5c07b'];
  else if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) [symbol, color] = ['▧', '#b48ead'];
  else if (ext === 'lock') [symbol, color] = ['⌑', '#a3a3a3'];
  return (
    <span aria-hidden className="flex size-[16px] shrink-0 items-center justify-center" style={{ color }}>
      {folder ? (
        <svg viewBox="0 0 16 16" className="size-[16px]" fill="#dcb67a">
          <path d={open ? 'M1 4a1 1 0 0 1 1-1h3.5L7 4.5h6a1 1 0 0 1 1 1V6H4a1.3 1.3 0 0 0-1.2.8L1 11.5z' : 'M1.5 4A1.5 1.5 0 0 1 3 2.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5V12a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12z'} />
          {open && <path d="M3.8 6.5H15l-1.8 6.2a1 1 0 0 1-1 .8H1.3l1.6-6.2a1 1 0 0 1 .9-.8Z" fill="#e8c68f" />}
        </svg>
      ) : symbol ? <span className="text-[10px] font-bold leading-none">{symbol}</span> : (
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" className="size-[16px]">
          <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
        </svg>
      )}
    </span>
  );
}
