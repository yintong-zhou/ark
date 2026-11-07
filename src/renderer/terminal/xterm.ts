/** xterm, loaded with the first terminal only: the startup bundle never carries it (spec §2, anti-goal). */
type Xterm = { Terminal: typeof import('@xterm/xterm').Terminal; FitAddon: typeof import('@xterm/addon-fit').FitAddon };

let loading: Promise<Xterm> | undefined;

export function loadXterm(): Promise<Xterm> {
  loading ??= Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit'), import('@xterm/xterm/css/xterm.css')]).then(
    ([x, fit]) => ({ Terminal: x.Terminal, FitAddon: fit.FitAddon }),
  );
  return loading;
}
