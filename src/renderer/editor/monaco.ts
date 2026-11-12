/**
 * Monaco, loaded on first use only: the startup bundle never carries it (spec §2, anti-goal). Workers are bundled
 * by Vite (`?worker`), so nothing is fetched from a CDN.
 */
import { onThemeApplied } from '../theme';

export type Monaco = typeof import('monaco-editor');

let loading: Promise<Monaco> | undefined;

export function loadMonaco(): Promise<Monaco> {
  loading ??= (async () => {
    const [monaco, editor, json, css, html, ts] = await Promise.all([
      import('monaco-editor'),
      import('monaco-editor/editor/editor.worker?worker'),
      import('monaco-editor/language/json/json.worker?worker'),
      import('monaco-editor/language/css/css.worker?worker'),
      import('monaco-editor/language/html/html.worker?worker'),
      import('monaco-editor/language/typescript/ts.worker?worker'),
    ]);
    const workers: Record<string, new () => Worker> = {
      json: json.default,
      css: css.default, scss: css.default, less: css.default,
      html: html.default, handlebars: html.default, razor: html.default,
      typescript: ts.default, javascript: ts.default,
    };
    self.MonacoEnvironment = { getWorker: (_id, label) => new (workers[label] ?? editor.default)() };
    defineTheme(monaco);
    onThemeApplied(() => {
      defineTheme(monaco);
      monaco.editor.setTheme('ark');
    });
    return monaco;
  })();
  return loading;
}

/** `ark` (dark or light, as the app is): the brand tokens from index.css, read at runtime so the editor never drifts from the app. */
function defineTheme(monaco: Monaco) {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => toHex(css.getPropertyValue(`--color-${name}`).trim());
  const light = document.documentElement.dataset.theme === 'light';
  monaco.editor.defineTheme('ark', {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': v('content'),
      'editor.lineHighlightBackground': v('sidebar'),
      'editor.selectionBackground': v('raised'),
      'editorCursor.foreground': v('secondary'),
      'editorLineNumber.foreground': light ? '#2C2F368C' : '#DEE1E68C', // body colour at 55%: muted
      'editorLineNumber.activeForeground': v('neutral-light'),
      'editorWidget.background': v('sidebar'),
      'minimap.background': v('content'),
    },
  });
}

/** Monaco takes #rrggbb; the tokens are hex already, but a browser may hand back rgb(). */
function toHex(c: string): string {
  if (c.startsWith('#')) return c;
  const m = c.match(/\d+/g);
  return m ? '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : '#000000';
}
