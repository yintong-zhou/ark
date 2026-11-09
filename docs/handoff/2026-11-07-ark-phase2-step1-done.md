---
type: handoff
date: 2026-11-07
status: fatto (passo 1 della Fase 2 sul branch phase2-step1-files-editor, pushato, non unito a main)
seq: 4
prev: docs/handoff/2026-11-06-ark-phase1-step4-done.md
tags: [ark, electron, phase2, step1, files, editor, monaco, done]
---

# Handoff - Ark Fase 2, passo 1 (file ed editor), completato

## Obiettivo

La Fase 2 porta dentro Ark le cose per cui oggi l'utente esce dall'app: guardare e correggere un file, lanciare un comando. Così può seguire un thread (team → piano → build → riepilogo) senza aprire VS Code o un terminale. Il passo 1 è **file explorer + editor**, il passo 2 sarà il **terminale**.

- Spec: `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md`. L'utente ha saltato le domande, quindi tutte le scelte sono mie e sono marcate **[call]**.
- Piano del passo 1: `docs/superpowers/plans/2026-11-07-phase2-step1-files-editor.md`.

## A che punto siamo

- **Branch.** `phase2-step1-files-editor` ha 12 commit sopra `main` (`8ea81d3`, "moved project": la storia precedente è stata schiacciata nello spostamento del repo). È pushato su `origin`. `main` **non** è stato toccato.
- **Controlli.** Passano typecheck, lint, `npm test` (472/472) e `npm run build`.
- **Visto nell'app costruita**, via CDP, con un profilo e un progetto finti nello scratchpad:
  - l'albero si apre e si crea un file dal menu contestuale;
  - un `.ts` si apre in Monaco: si scrive, il pallino di modifica compare, Ctrl+S salva tenendo il CRLF;
  - una modifica esterna su una tab pulita la ricarica in circa 170 ms;
  - una modifica esterna su una tab con modifiche mostra la barra "Changed on disk", e Ctrl+S non sovrascrive;
  - Keep mine sovrascrive;
  - un file binario mostra un segnaposto;
  - Ctrl+W chiude la tab, non la finestra;
  - andando su Usage e tornando restano tab, modifiche e riga del cursore (201);
  - un reload della pagina con modifiche aperte mostra il dialogo, e **Cancel** tiene pagina e modifiche.
- **Non verificato in automatico:**
  - il pulsante **Discard changes** del dialogo;
  - la root "worktree" di un thread vero, mai provata con un build reale;
  - `npm run dist` (va fatto nel passo 2, insieme a node-pty).
- **Cosa è entrato:**
  - **main:**
    - `services/files/guard.ts`: `normRel`, `normEntry`, `resolveInside` (realpath, confronto senza maiuscole), `rootRef`, `rootDir`;
    - `services/files/ops.ts`: list (limite 5000 voci, `.git` nascosto), read (5 MB, binari, BOM, non-UTF-8 in sola lettura), stat, write con controllo mtime, create, rename, trash;
    - `services/files/watch.ts`: `fs.watch` ricorsivo, raggruppato ogni 150 ms, con conteggio dei riferimenti;
    - gli handler IPC `files:*`;
    - `will-prevent-unload` in `main/index.ts`.
  - **shared:**
    - `files.ts`: i tipi e `UUID_RE`, spostata qui da `ipc/index.ts`;
    - `editor-tabs.ts`: le regole pure su modifiche su disco, conflitti e salvataggi.
  - **renderer:**
    - `files/tree-store.ts` ed `editor/tabs-store.ts`, store a livello di modulo che sopravvivono al cambio di schermata;
    - `editor/monaco.ts`, il caricamento lazy con worker Vite `?worker` e il tema `ark-dark` preso dai token CSS;
    - `FileTree`, `Menu`, `TabStrip`, `Editor`;
    - il cablaggio in `pages/Threads.tsx`.
  - **Correzione di Fase 1** (primo commit): `threads/workspace.ts` ora gestisce da sé timeout e limite di output dei check e uccide l'intero albero con `taskkill /T /F`. Prima moriva solo `cmd.exe`, npm restava vivo e teneva occupato il worktree, e i test `workspace` fallivano a caso con `EPERM`.

## Cosa abbiamo provato che NON ha funzionato

- **`execFile` con `timeout`/`maxBuffer` e `shell: true`.** Uccide solo la shell. Va fatto un timer proprio e `taskkill` finché la shell è viva. Vale anche per il limite di output: uno script che finisce di scrivere prima del kill esce con 0, quindi "fermato da noi" va trattato come fallito.
- **Scrivere con un `<file>.tmp` fisso in `writeAtomic`.** Un symlink piantato con quel nome faceva scrivere fuori dalla root; il revisore lo ha dimostrato. Ora il nome del temp è unico e la scrittura usa `flag: 'wx'`.
- **Il conteggio dei file sporchi via IPC (`editor:dirty`) più un dialogo su `win.on('close')`.** Ctrl+R / reload buttava via le modifiche senza chiedere. Sostituito da `beforeunload` nel renderer più `will-prevent-unload` nel main, un solo meccanismo per chiusura e reload.
- **Mettere il focus sulla textarea di Monaco nei test CDP.** Monaco 0.57 usa `EditContext`: il focus va su `.monaco-editor .native-edit-context`.
- **Controllare il testo dell'editor con `.view-lines.textContent`.** Gli spazi sono NBSP: fai `.replace(/ /g, ' ')`.
- **Trovare i pulsanti del dialogo nativo con UI Automation.** Sono `Pane` senza pattern Invoke. Per Cancel: `PostMessage(hwnd del #32770, WM_COMMAND, IDCANCEL)`. Discard non è stato premuto.
- **Python per editare i file.** Non è installato su questa macchina: usa Edit o `node -e`.
- **sed / node -e con template string, backtick o backslash in Bash.** Hanno corrotto i file più volte: righe con `${}` svuotate, `'\\'` diventato `'\'`. Per le modifiche con quei caratteri usa lo strumento Edit.

## Problemi incontrati e come li abbiamo risolti

- **I test del renderer non passano il typecheck.** Sintomo: `TS2307` su `?worker`. Causa: `tests/**` era in `tsconfig.node.json`. Correzione: `tests/renderer/**` va in `tsconfig.web.json` ed è escluso da quella node.
- **Lint `react-hooks`.** Niente assegnazioni a ref durante il render (va in un effect), e niente riassegnazioni di variabili di modulo dentro un componente (il setter va definito fuori).
- **Processi rimasti aperti.** Le app lanciate in background lasciano `electron.exe` vivi. Chiudili con `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`, filtra la riga di comando su `*ark-profile*`, poi `Stop-Process`.
- **I test del watcher sono a tempo reale.** `vi.waitFor` fino a 2 s; sono stabili, verificati 3 volte di fila.

## Decisioni prese

- **Monaco per l'editor.** Scartato CodeMirror 6, più leggero, perché il brief dice "stile VS Code". Monaco sta in un chunk a parte: `index-*.js` cresce di solo +33 kB.
- **xterm.js + node-pty per il terminale (passo 2).** Scartato `child_process` senza PTY, perché senza PTY non c'è un vero terminale. node-pty 1.1.0 ha prebuild N-API ed è stato provato sotto Electron 45 senza rebuild.
- **Il renderer manda solo root + percorso relativo.** Il main risolve e controlla tutto. Scartato il passare percorsi assoluti.
- **La striscia di tab compare solo dopo aver aperto un file.** La spec diceva "sempre"; è una scelta mia.
- **Il versioning si basa solo sull'mtime.** Scartato aggiungere la size. Rimandato (minore #12).
- **`saveBase` vale -1 per una tab senza versione su disco** (file ricomparso): va in conflitto invece di sovrascrivere.
- **Il tuo downgrade di eslint 9 / typescript-eslint 8.36 è committato nel commit di Monaco.** Il lock file non si poteva dividere. Va detto all'utente se lo chiede.

## File toccati

- `src/main/services/files.ts`: `writeAtomic` con un temp unico ed esclusivo, che accetta anche `Uint8Array`.
- `src/main/services/files/{guard,ops,watch}.ts`: nuovi.
- `src/main/services/threads/workspace.ts`: l'uccisione dell'albero dei check.
- `src/main/ipc/index.ts`: gli handler `files:*`, `normEntry` per le operazioni distruttive, il watcher.
- `src/main/index.ts`: `will-prevent-unload`.
- `src/preload/index.ts`, `src/shared/types.ts`: `ArkApi.files`.
- `src/shared/files.ts`, `src/shared/editor-tabs.ts`: nuovi.
- `src/renderer/files/tree-store.ts`, `src/renderer/editor/{monaco,tabs-store}.ts`: nuovi.
- `src/renderer/components/{FileTree,Menu,TabStrip,Editor}.tsx`: nuovi.
- `src/renderer/pages/Threads.tsx`: il selettore Threads/Files, il selettore della root, la striscia di tab e l'Editor (con `key={project.id}`).
- `src/renderer/index.html`: CSP con `worker-src 'self' blob:`.
- `tsconfig.node.json`, `tsconfig.web.json`: dove stanno i test del renderer.
- `package.json` / lock: `monaco-editor@0.57.0` in devDependencies, più il pin di eslint dell'utente.
- `tests/main/files-{guard,ops,watch}.test.ts`, `tests/shared/editor-tabs.test.ts`, `tests/renderer/tabs-store.test.ts`: nuovi. L'ultimo usa un harness con `window.ark` e Monaco finti.
- `README.md`: la sezione "Files and editor". `CLAUDE.md`: il layout e la regola sulle scritture dell'editor.

## Dove vogliamo andare

1. Fai decidere all'utente se unire `phase2-step1-files-editor` in `main`, in locale con fast-forward come nelle fasi precedenti, oppure aprire una PR.
2. Chiedi all'utente di provare a mano:
   - **Discard changes** nel dialogo, sia chiudendo la finestra sia con Ctrl+R;
   - la root "worktree" di un thread in fase di build.
3. Apri il **passo 2, il terminale**: scrivi il piano da spec §5.4, §6.4 e §8 con writing-plans, poi esegui. I punti chiave:
   - node-pty in `dependencies`;
   - in `electron-builder.yml`: `asarUnpack: node_modules/node-pty/**` e `npmRebuild: false`;
   - xterm.js con `@xterm/addon-fit`;
   - la shell prende l'env dell'utente meno `ELECTRON_*`, non `cleanEnv`;
   - tutti i PTY vengono uccisi al reload e al quit;
   - l'xterm vive a livello di modulo nel renderer, come le tab;
   - alla fine `npm run dist` e la verifica che node-pty si carichi dall'asar spacchettato.
4. **Minori rimandati** (dalla revisione finale), da fare quando si tocca la zona:
   - #9: un doppio clic durante il primo caricamento di Monaco dà "model already exists";
   - #10: la rinomina tramite temp perde hard link e ACL;
   - #11: la rinomina solo maiuscole/minuscole viene rifiutata;
   - #12: il versioning usa solo l'mtime (FAT ha risoluzione di 2 s);
   - #13: un errore del watcher perde il conteggio dei riferimenti;
   - #14: se la root dell'albero fallisce, non viene più ritentata;
   - #15: il menu contestuale riprende il focus quando il genitore si ridisegna;
   - #16: i link a cartelle dentro la root non si espandono;
   - #17: in `workspace.ts`, `taskkill` potrebbe colpire un PID riusato se la shell è già uscita.

## Da sapere prima di toccare qualcosa

- **Valgono le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - per provare l'app usa `--user-data-dir` nello scratchpad;
  - commit con `git commit -F`;
  - `npm run test:live` costa token: chiedi prima.
- **Ricetta CDP per provare l'app:**
  - `npm run build`;
  - `ELECTRON_RENDERER_URL= node_modules/.bin/electron . --user-data-dir=<profilo> --remote-debugging-port=9333`, in background;
  - un driver Node con `fetch` e `WebSocket` globali.

  Il driver usato era `scratchpad/cdp.mjs` (con `click`, `context`, `type`, `key`, `until`, `shot`, `send`). Lo scratchpad non sopravvive: va riscritto, ed è circa 80 righe. Il profilo si costruisce scrivendo `projects.json`, un array di `{id: uuid, name, dir, git}`.
- **Il revisore finale ha lavorato su `opus`.** Il pacchetto si genera con `review-package` della skill subagent-driven-development. Il workspace SDD di questo piano è stato cancellato: la storia è in Git e in questo file.
- **`tabs-store.ts` registra `beforeunload` quando il modulo viene caricato.** Nei test, lo stub di `window` deve avere `addEventListener`.
- **Non togliere `normEntry` dagli handler distruttivi:** `''` è la root, e `files:remove(root, '')` cestinerebbe l'intero progetto.
