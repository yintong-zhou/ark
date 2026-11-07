/** The user's own shells in the bottom panel (spec §5.4). */
export type ShellId = 'powershell' | 'cmd' | 'gitbash';
export type ShellOption = { id: ShellId; name: string };
