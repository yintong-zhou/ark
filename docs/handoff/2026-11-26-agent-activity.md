---
type: handoff
date: 2026-11-26
status: pronto-per-review
seq: 1
prev: nessuno
tags: [ark, thread, agenti, activity, team-panel, codex]
---

# Handoff - Stato degli agenti nel thread (activity)

Branch `feat/agent-activity`, creato da `main` (HEAD `ad90990`), **nessun commit**: tutto è nel working tree. Spec: `docs/superpowers/specs/2026-11-26-agent-activity-design.md`. Piano: `docs/superpowers/plans/2026-11-26-agent-activity.md`.

## Obiettivo

Mentre un thread lavora, l'utente aspetta senza sapere se succede qualcosa. Deve vedere che la sessione è viva, quale agente lavora, su cosa (compito più azione corrente, in modo generico) e quando ogni agente ha finito. Per questo: una riga di progresso in fondo alla conversazione e uno stato per ogni agente nel pannello Team (*working*, *your turn*, *done*, *standby*).

## A che punto siamo

Tutto il piano (7 task) è implementato e verificato, ma non committato.

- Funziona: gli engine emettono un evento `activity` (solo categoria), il conductor tiene `{agent, action, since}` per thread in memoria e lo manda al renderer su un canale IPC dedicato; `ProgressRow` in fondo ai messaggi e `TeamPanel` con `Presence` a 4 stati.
- Controlli sull'albero finale: lint pulito, typecheck 0 errori, build ok, 505 test verdi nei file toccati, app avviata in dev senza errori (poi chiusa).
- Revisione finale (Opus, contesto nuovo): nessun Critical, 1 Important (corretto), 5 Minor (rinviati).
- **Non fatto:** nessuna prova con un thread reale, che consuma token delle sottoscrizioni (va chiesto prima). Quindi riga e pannello non sono mai stati visti dal vivo con un agente che lavora.
- **Non deciso:** cosa fare del branch (merge locale su `main`, push e PR, oppure tenerlo). L'utente non ha ancora risposto.
- README non aggiornato (il piano non lo prevedeva).

## Cosa abbiamo provato che NON ha funzionato

- **Worktree isolato:** scartato. Servirebbe `npm install` nel worktree, che rischia di toccare `node-pty` (CLAUDE.md: mai ricostruirlo), e Codex doveva lavorare nello stesso albero. Si è usato un branch nel checkout principale.
- **Campo `thread.activity` sul `Thread`** (scartato già nel design): ogni tool call riscriveva il JSON del thread su disco e rifaceva il render dei messaggi.
- **`thinking` emesso dall'engine a inizio turno** (scartato nel piano): il conductor lo imposta già da solo quando `speaking` si valorizza, sarebbe un evento doppio.
- **Suite completa come prova di verde:** non è affidabile su questa macchina, vedi sotto.

## Problemi incontrati e come li abbiamo risolti

- **`motion` mancante da `node_modules`.** Sintomo: `team-panel.test.ts` e `permission-select.test.ts` fallivano con `Cannot find package 'motion/react'` già prima delle modifiche. Causa: era in `package.json` ma non installato. Correzione: `npm install motion@^14.14.0 --ignore-scripts --no-save` (dry-run: +5 pacchetti, niente rimosso né ricostruito).
- **Crash di `useActivity` con `threadId` e stato entrambi `undefined`.** Sintomo: il test esistente del costo del thread falliva con `Cannot read properties of undefined (reading 'activity')`. Causa: `state?.id === threadId` è vero se sono entrambi `undefined`. Correzione: `state && state.id === threadId`.
- **Stesso agente per due turni di fila teneva il vecchio `since` e la vecchia azione.** Causa: `emit()` azzera l'attività solo quando cambia l'agente, ma `speaking` non si svuota tra una correzione o una risposta a un messaggio dell'utente e il turno dopo. Correzione: in `speak()` di `conductor.ts`, prima di `runner.turn`, si azzera la voce **solo se esiste già per lo stesso agente**. Test: `activity: a second turn of the same agent starts again as thinking with a new start time`.
- **Suite completa instabile su Windows.** Sintomo: da 3 a 36 test rossi a seconda del carico, sempre in `tests/main/git.test.ts`, `files-ops.test.ts`, `workspace.test.ts`, con `Test timed out in 5000ms` o `EPERM` su cartelle temporanee. Causa: operazioni git lente. Prova: con `--testTimeout=120000 --hookTimeout=120000`, `git.test.ts` e `files-ops.test.ts` passano 76/76 e `workspace.test.ts` da solo 20/20. Il baseline prima delle modifiche aveva già 15 rossi per le stesse cause.

## Decisioni prese

- **Canale IPC transitorio, non persistito** (scelto) invece del campo su `Thread` (scartato, vedi sopra). Dopo un riavvio si azzera ed è giusto.
- **Stato per agente da funzioni pure** in `src/shared/thread-view.ts` (`agentState`, `taskLine`): *done* = ha risposto dopo l'ultimo messaggio utente o l'ultima card di fase; *standby* altrimenti. Scartato: salvare lo stato.
- **Riga del compito solo per chi ha un ruolo di build** (builder, code review, security review); l'Head of Staff in build mostra solo l'azione. Scartato: mostrare "Phase i/n" a chiunque parli in build, sarebbe fuorviante.
- **Approvazione aperta:** la riga resta e dice *Waiting for approval*, ricavato da `thread.approvals`. Scartato: azzerarla dal conductor.
- **Timer:** `since` lo registra il conductor quando valorizza `speaking`; c'è anche `threads:get-activity` per un thread aperto a metà turno o dopo un reload.
- **Tipi in `src/shared/activity.ts`** (`ActivityAction`, `ThreadActivity`), non in `types.ts`, dove restano solo i riferimenti.
- **`Presence`:** l'etichetta di `speaking` ora è `working`; aggiunti `done` (spunta) e `standby` (anello vuoto). Nessun test dipendeva dall'etichetta vecchia.
- **Nessun `aria-live` sulla riga:** un timer che cambia ogni secondo sommergerebbe gli screen reader.
- **Nessun commit** finché l'utente non lo chiede (regola dell'harness), quindi niente script di fine task con intervalli di commit.
- **Divisione del lavoro:** Codex ha scritto i Task 2, 3 e 4 (engine, conductor, IPC, preload), Claude i Task 1, 5, 6; verifica e diff di Codex riletti da Claude.

## File toccati

Nuovi:
- `src/shared/activity.ts` - tipi, mapping tool-azione (Claude e Codex), etichette, `elapsed`.
- `src/renderer/hooks/useActivity.ts` - sottoscrizione per thread al canale `threads:activity`.
- `src/renderer/components/ProgressRow.tsx` - la riga di progresso, con timer proprio.
- `tests/shared/activity.test.ts`, `tests/renderer/progress-row.test.ts` - test dei due sopra.
- `docs/superpowers/specs/2026-11-26-agent-activity-design.md`, `docs/superpowers/plans/2026-11-26-agent-activity.md`.

Modificati:
- `src/shared/types.ts` - evento `activity` in `ChatEvent`, `window.ark.threads.activity/onActivity`.
- `src/shared/chat-log.ts` - il reducer ignora `activity`.
- `src/shared/thread-view.ts` - `agentState`, `taskLine`.
- `src/main/services/engines/claude-session.ts`, `codex-session.ts` - emettono `activity` da `tool_use` e `item/started`.
- `src/main/services/threads/conductor.ts` - mappa `liveActivity`, `onActivity`, `activity`, azzeramento in `emit()`, in `remove()` e in `speak()`.
- `src/main/ipc/index.ts`, `src/main/index.ts`, `src/preload/index.ts` - `threads:get-activity` e `threads:activity`.
- `src/renderer/components/Shell.tsx` (`Presence`), `TeamPanel.tsx`, `ThreadView.tsx` (riga in fondo, scroll quando cambia `speaking`).
- `tests/main/claude-session.test.ts`, `codex-session.test.ts`, `conductor.test.ts`, `tests/renderer/team-panel.test.ts`, `tests/shared/chat-log.test.ts`, `thread-view.test.ts`.

## Dove vogliamo andare

1. Chiedere all'utente cosa fare del branch: **1** merge locale su `main`, **2** push e Pull Request, **3** tenerlo. Con 1 o 2 si committa prima, con il trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (e la riga `🤖 Generated with [Claude Code](https://claude.com/claude-code)` nella PR).
2. Se l'utente è d'accordo a spendere token: prova dal vivo con `npm run dev` e un thread piccolo, per vedere la riga, il timer, *done*/*standby* e il reset dopo una pausa o un reload.
3. Valutare un aggiornamento del README (comportamento visibile all'utente).
4. Rinviati, se l'utente li vuole: `useActivity` può scartare un fetch fresco con A, B, A e fetch lento su B; timer fermo su 0:00 senza attività per lo speaker; un frame di "Thinking - 0:00" a fine turno (l'azzeramento parte prima di `threads:update`); `in` su oggetti piani in `claudeAction`/`codexAction` accetta chiavi come `constructor` (usare `Object.hasOwn`); `ProgressRow` e `TeamPanel` duplicano la logica dell'etichetta e hanno una prop `activity` usata solo dai test.

## Da sapere prima di toccare qualcosa

- Niente è committato: 18 file modificati e 7 nuovi (spec e piano inclusi).
- Per i test di `git.test.ts` e `files-ops.test.ts` usare `--testTimeout=120000 --hookTimeout=120000`, altrimenti falliscono per timeout su questa macchina.
- `motion` è installato fuori dal lockfile (`--no-save`): un `npm ci` lo rimette in regola. Non fare `npm install` normale né ricostruire `node-pty`.
- Dopo `npm run dev` restano processi `electron` e `node`: chiuderli per PID verificando che la command line contenga `Devs\Personal\ark`, mai per nome, per non toccare altre app Electron.
- Un comando Bash con `ls node_modules` è stato rifiutato dai permessi: per cercare lì usare Glob o Grep.
- Per modificare i test non usare heredoc con fallback python/node: usare Edit.
- `TeamPanel` e `ProgressRow` accettano una prop `activity` solo per i test; in produzione leggono da `useActivity`.
- `npm run test:live` consuma token: chiedere sempre prima.
- Il ledger del piano (`.superpowers/`) è stato cancellato; i suoi rulings sono in questo file. I log di baseline e finali sono in `.tmp/` (git-ignorato).
