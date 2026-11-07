---
type: handoff
date: 2026-11-07
status: fatto (Fase 2 completa: passo 2, il terminale, unito in main e pushato)
seq: 5
prev: docs/handoff/2026-11-07-ark-phase2-step1-done.md
tags: [ark, electron, phase2, step2, terminal, node-pty, xterm, done]
---

# Handoff — Ark Fase 2, passo 2 (terminale), completato

## Obiettivo

La Fase 2 porta dentro Ark le cose per cui l'utente usciva dall'app: guardare e correggere un file (passo 1) e lanciare un comando (passo 2). Così può seguire un thread (team → piano → build → riepilogo) senza aprire VS Code o un terminale. Con questo passo la Fase 2 è chiusa; la prossima in `PROJECT.md` è la **Fase 3, gestione Git completa**.

- Spec: `docs/superpowers/specs/2026-11-07-phase2-editor-terminal-design.md` (§5.4, §5.5, §6.4, §8, §10).
- Piano: `docs/superpowers/plans/2026-11-07-phase2-step2-terminal.md`.

## A che punto siamo

- **Git.** `phase2-step2-terminal` (8 commit, questo handoff incluso) unito in `main` con fast-forward e pushato.
- **Controlli.** Passano typecheck, lint, `npm test` (497/497, con uno smoke test vero di node-pty: `cmd.exe /c echo`) e `npm run build`.
- **Visto nell'app costruita**, via CDP:
  - Ctrl+` apre `PowerShell 1` nella cartella del progetto ed `echo` funziona;
  - `+` → Command Prompt, poi `exit` mostra "Process exited (code 0)" e la tab resta;
  - andando su Usage e tornando restano terminali e scrollback;
  - un reload chiude tutte le shell;
  - un reload **annullato** con Cancel (file non salvato) tiene vivi i terminali;
  - all'avvio a freddo un clic sul pulsante apre il terminale.
- **`npm run dist` fatto.** `dist/win-unpacked/Ark.exe` apre un terminale ed esegue `echo`; node-pty si carica da `app.asar.unpacked`.
- **Non verificato:**
  - Ctrl+C con una selezione e Ctrl+V nel terminale;
  - se un processo lanciato dentro la shell (es. `npm run dev`) muore quando si chiude Ark;
  - dal passo 1: **Discard changes** nel dialogo, e la root "worktree" di un thread in build.
- **Cosa è entrato:**
  - **main:** `services/terminals.ts` (shell, env, batch 16 ms, `Terminals`), gli handler `terminal:*` in `ipc/index.ts`, la pulizia al reload spostata su `did-start-navigation`.
  - **shared:** `terminal.ts` (`ShellId`, `ShellOption`), `ArkApi.terminal` in `types.ts`.
  - **renderer:** `terminal/xterm.ts` (caricamento lazy), `terminal/terms-store.ts` (store a livello di modulo), `components/TerminalPanel.tsx`, il pulsante in `TabStrip.tsx`, Ctrl+` e il divisore in `pages/Threads.tsx`, `TerminalIcon`.
  - **packaging:** `node-pty@1.1.0` in `dependencies`, `@xterm/xterm@6.0.0` e `@xterm/addon-fit@0.11.0` in dev; in `electron-builder.yml` ci sono `asarUnpack` per node-pty e `npmRebuild: false`.

## Cosa abbiamo provato che NON ha funzionato

- **Pulire al reload su `did-start-loading`.** Scatta *prima* di `beforeunload`. Con un file non salvato, Ctrl+R e poi Cancel, la pagina restava ma terminali, chat e watcher erano già stati uccisi; i terminali sembravano vivi e i tasti finivano in "Unknown terminal". Ora la pulizia è su `did-start-navigation` filtrato con `isMainFrame && !isSameDocument`. Era un bug anche del passo 1 (chat e watcher).
- **Aprire xterm (`open(el)`) su un `<div>` staccato dal DOM.** Non si può misurare, quindi cols e rows sbagliati. Si apre al primo `attach` nel pannello.
- **Tenere l'output "arrivato prima del create" senza limiti.** L'output di un terminale già chiuso restava in memoria per sempre. Ora si tiene solo mentre un create è in volo e si svuota quando non ce ne sono.
- **`toggle` senza stato "starting".** Il pannello restava vuoto per secondi al primo avvio, e riaprendolo partiva una seconda PowerShell.
- **CDP `Runtime.evaluate` che restituisce un nodo DOM con `returnByValue`.** Torna `undefined`, quindi `until(querySelector(...))` va in timeout. Usa `!!`.
- **`FindWindow('#32770', null)` subito dopo il reload.** Il dialogo nativo arriva dopo diversi secondi, e intanto il main è bloccato in `showMessageBoxSync`, quindi CDP non risponde. Va cercato tra le finestre del PID di Ark, con un'attesa fino a 30 s (vedi sotto).
- **`Set-Content -Encoding utf8` per il messaggio di commit.** In PowerShell 5.1 scrive un BOM che finisce nell'oggetto del commit. Usa `[IO.File]::WriteAllText` o lo strumento Write.

## Problemi incontrati e come li abbiamo risolti

- **Due create in parallelo al primo avvio.** Avrebbero creato due `Terminals` e lasciato orfano un PTY. node-pty si importa ora con una promise memorizzata (`termsReady`) in `ipc/index.ts`.
- **`useSyncExternalStore` con una vista vuota nuova a ogni chiamata.** Va in loop: serve una costante `EMPTY`.
- **Test con una classe finta restituita da un costruttore.** Non passa il typecheck; nel mock usa `class extends FakeTerminal`.

## Decisioni prese

- **node-pty caricato con `import()` al primo terminale.** Scartato l'import in cima: un modulo nativo rotto farebbe crashare l'app invece di dare un errore nel pannello.
- **`kill` su un id sconosciuto non fa nulla**, mentre `write` e `resize` lanciano "Unknown terminal". La shell può uscire mentre l'utente chiude la tab.
- **La striscia delle tab si vede sempre** quando c'è un progetto, perché ci sta il pulsante del terminale. Nel passo 1 compariva solo con file aperti.
- **Ctrl+` usa `e.code === 'Backquote'`**, cioè il tasto fisico a sinistra di `1`; sulla tastiera italiana è `\`. Scartato il controllo sul carattere, che sul layout IT non esiste.
- **L'altezza del pannello è una frazione di `<Main>`** (0,15–0,85, di default 0,35), tenuta solo in memoria.
- **La root del terminale segue il selettore della cartella in Files**, anche con la vista Threads attiva (spec §5.4).
- **Ambiente della shell:** `process.env` meno `ELECTRON_*`, non `cleanEnv`, perché è la shell dell'utente.

## File toccati

- `src/main/services/terminals.ts`, `src/shared/terminal.ts`: nuovi.
- `src/main/ipc/index.ts`: gli handler `terminal:*`; la pulizia al reload su `did-start-navigation`.
- `src/preload/index.ts`, `src/shared/types.ts`: `ArkApi.terminal`.
- `src/renderer/terminal/{xterm,terms-store}.ts`, `src/renderer/components/TerminalPanel.tsx`: nuovi.
- `src/renderer/components/{TabStrip,Icons}.tsx`, `src/renderer/pages/Threads.tsx`: il pulsante, l'icona, il pannello, Ctrl+` e il divisore.
- `electron-builder.yml`, `package.json` / lock: node-pty e xterm.
- `tests/main/terminals.test.ts`, `tests/renderer/terms-store.test.ts`: nuovi.
- `README.md`: sezione "Terminal". `CLAUDE.md`: il layout e la regola sul terminale.

## Dove vogliamo andare

1. **Chiedi all'utente di provare a mano:**
   - Ctrl+C con una selezione e Ctrl+V nel terminale;
   - `npm run dev` (o un `node` che resta acceso) dentro PowerShell, poi chiudi Ark: il processo deve morire;
   - dal passo 1: **Discard changes** (chiudendo la finestra e con Ctrl+R) e la root worktree durante un build.
2. **Apri la Fase 3 (gestione Git completa, `PROJECT.md`)** con brainstorming → spec → writing-plans. Lo spec di Fase 2 le assegna già i colori di stato nell'albero, i diff e lo staging.
3. **Minori rimandati.** Falli quando tocchi la zona.
   - Dal terminale:
     - un reload durante un `terminal:create` in volo lascia un PTY orfano fino alla chiusura (serve un contatore di generazione in `ipc/index.ts`);
     - lo slice da 64 KB dell'incolla può spezzare una coppia surrogata (emoji) al confine;
     - scrivere o ridimensionare un terminale già uscito riempie il log del main di "Unknown terminal";
     - chiudere il pannello con Ctrl+` dall'xterm lascia il focus su `<body>`;
     - il divisore non si muove da tastiera;
     - non c'è contropressione sull'output;
     - non c'è un limite di terminali per progetto;
     - un errore di socket di node-pty senza listener potrebbe far crashare il main (comportamento della libreria, nessun caso noto).
   - Dal passo 1: #9–#17 nell'handoff precedente (`2026-11-07-ark-phase2-step1-done.md`).

## Da sapere prima di toccare qualcosa

- **Valgono le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - per provare l'app usa `--user-data-dir` nello scratchpad;
  - commit con `git commit -F`, file senza BOM;
  - `npm run test:live` costa token: chiedi prima.
- **Ricetta CDP** (lo scratchpad non sopravvive, va riscritta):
  - **build e avvio:** `npm run build`, poi `$env:ELECTRON_RENDERER_URL=''` e `Start-Process node_modules\electron\dist\electron.exe -ArgumentList ".","--user-data-dir=<profilo>","--remote-debugging-port=9333"`;
  - **profilo:** `<profilo>\projects.json` = `[{id: uuid, name, dir, git:false}]`;
  - **driver:** circa 60 righe di Node con `fetch` e `WebSocket` globali. Funzioni: `ev`, `until` (le espressioni devono tornare booleani), `key` (Ctrl = `modifiers: 2`; Ctrl+` = `code: 'Backquote', vk: 192`), `type` (`Input.insertText`) e `shot`. In più `Runtime.enable` per stampare le eccezioni della pagina;
  - **testo di xterm:** `section[aria-label=Terminals] .xterm-rows` `textContent` con NBSP → spazio. Il focus va sulla `textarea` dentro la sezione;
  - **dialogo "unsaved changes":** manda `Page.reload` senza aspettare la risposta, cerca la finestra `#32770` tra quelle del PID di electron (EnumWindows, fino a 30 s), poi `PostMessage(hwnd, WM_COMMAND=0x111, IDCANCEL=2, 0)`;
  - **shell vive:** cerca i discendenti del processo `electron.exe` con `*ark-profile*` nella riga di comando (`Get-CimInstance Win32_Process`).
- **Chiudere l'app di prova:** filtra `electron.exe` per `*ark-profile*`. **Non** usare `Get-Process Ark | Stop-Process`: chiude anche un Ark installato dell'utente. È successo con il pacchetto di `dist`; per quello filtra `Ark.exe` sul percorso `dist\win-unpacked`.
- **node-pty non va mai ricompilato** (`npmRebuild: false`): usa i prebuild N-API. Se un giorno non si carica, il pannello mostra "Couldn't start the terminal: …" invece di far crashare l'app.
- **Lo store dei terminali** registra i listener `onData` / `onExit` una volta per modulo. Nei test, lo stub di `window.ark.terminal` deve catturarli prima dell'import.
