---
type: handoff
date: 2026-11-05
status: pronto per review (manca la prova manuale)
seq: 5
prev: docs/handoff/2026-11-05-ark-phase1-step2.md
tags: [ark, electron, phase1, step2, threads, conductor, subagent-driven]
---

# Handoff - Ark Fase 1, passo 2 (thread col team) completato

## Obiettivo

Ark Fase 1: al posto di un solo Opus che fa tutto, un piccolo team di agenti lavora in un thread. Il motivo è il **costo**: i modelli economici fanno il lavoro facile, Opus solo quello difficile, e la qualità resta quella di oggi.

Il passo 2 aggiunge progetti e thread:
- il project manager propone il team e l'utente lo approva;
- il PM sceglie chi parla a ogni turno;
- gli agenti possono rivolgersi all'utente con `@you`;
- l'utente reagisce 👍/👎 ai messaggi;
- il piano finisce in una card con **Start developer**, che per ora registra solo l'approvazione.

## A che punto siamo

- **Branch `phase1-step2-team-threads`:** HEAD `47fbf61`, 14 commit da `4f48376`, non pushato. È non tracciato solo questo handoff, insieme al precedente `2026-11-05-ark-phase1-step2.md`.
- **Piano eseguito per intero** (Task 1→10, subagent-driven). Ogni task ha avuto la sua revisione.
- **Revisione finale** del branch su Opus: "With fixes", con 3 Important.
  - **I1:** il PM nuovo, nella fase team, non riceveva più il catalogo.
  - **I2:** una scelta fuori catalogo rendeva inutilizzabile la card del team.
  - **I3:** l'handoff di contesto su Claude usava l'uso cumulativo del turno.

  Tutti e tre sono corretti in `47fbf61`, insieme a 4 ritocchi minori, e la ri-revisione dice "all addressed".
- **Verde:**
  - `npm test`: 269/269;
  - typecheck, lint e build;
  - `npm run test:live`: 3/3, rilanciato dopo le correzioni. Il PM gira su `claude-haiku-5-5` e risponde con un blocco `team` in circa 4 s, senza violazioni d'isolamento.
- **Processi:** dopo i test non resta nessun `claude`, `codex` o `electron` orfano.
- **Commit dei task 8–10 e delle correzioni:**
  - `e70ba41` IPC;
  - `b941e9f` schermata Threads;
  - `11b865b` test live e README;
  - `47fbf61` correzioni della revisione finale.
- **Non fatto: la prova manuale in dev (Task 10, passo 3).** La revisione finale la indica come obbligatoria prima del merge. Lo strumento di automazione non riesce a pilotare il selettore di cartelle nativo, quindi serve l'utente.
  - La schermata Threads è stata vista solo su un profilo di prova, con thread finti e via CDP.
  - Mai provati dal vivo: Add project, Initialize Git, Approve, Start developer, Pause e la riapertura dopo una chiusura.
  - Mai provati in dev nemmeno il lock di istanza singola e il comportamento al reload (Task 1).

## Cosa abbiamo provato che NON ha funzionato

- **Mandare `NOTES.teamStart` solo da `create()`.** Dopo una pausa, un errore, un timeout o un riavvio, il PM ripartiva senza catalogo. → Ora lo aggiunge `run()` a ogni sessione nuova del manager in fase `team`.
- **Accettare qualsiasi `team` dal PM.** Un id inventato faceva fallire sempre Approve, e la card non ha un modo per togliere una scelta. → Il conductor trasforma un id sconosciuto in un errore `ark block: unknown agent: x`, così scatta l'unica correzione prevista dalla regola 2. Le regole restano pure.
- **Usare `result.usage` di Claude per il 50% del contesto.** È la somma su tutte le richieste del turno, quindi con molti tool l'handoff scattava troppo presto. → Il riempimento ora è l'`usage` dell'ultimo evento `assistant` (`contextUsed`). La somma resta per il display. La finestra viene dalla voce di `modelUsage` con lo stesso nome del modello.
- **Base della revisione finale = `git merge-base main HEAD`.** Include i commit del passo 1, perché la PR #3 è stata squashata. → Usare `4f48376`, cioè l'inizio del branch.
- **Le regole del piano** (cursore uguale al seq della risposta, `afterReply` che esce subito sulla correzione, ecc.): vedi l'handoff precedente, valgono ancora.

## Problemi incontrati e come li abbiamo risolti

- **L'IPC accettava testo fatto solo di spazi** (1..100 000 caratteri). → La UI disabilita Start thread e Send quando il testo, tolti gli spazi, è vuoto.
- **Le sessioni dei thread sopravvivono a Ctrl+R** (le chat no). → `useThreads` ricarica le liste e si ri-iscrive a `threads.onUpdate` al mount.
- **Un errore di `useThreads` restava per sempre** e nascondeva i `problem` successivi. → Ora si azzera dopo un'apertura riuscita.

## Decisioni prese

Questo è l'elenco completo delle decisioni prese durante l'esecuzione, ognuna con il suo costo se fosse sbagliata.

1. **I controlli `team` e `next` di un membro si ignorano** e la parola torna al PM (spec §8.2). Se sbagliato, una proposta di team di un membro si perde in silenzio.
2. **La nota "non valido" usa l'id dell'agente,** non il nome, perché le regole sono pure. Il costo è solo estetico: si legge "planner" invece di "Planner".
3. **Task 4: le correzioni contro la perdita di dati sono entrate in un giro di fix anche con la revisione "approved"** (riga troncata, `recover()` che faceva crashare l'avvio, riga `null`, `writePlan` non atomico). Se sbagliato, costa solo un giro in più.
4. **Un'interruzione arrivata durante un `wait` si applica subito** con `afterUser`. Se sbagliato, un `ask` può essere risposto da un messaggio scritto prima che l'utente vedesse la domanda.
5. **Il cursore è l'ultimo seq incluso nell'input del turno**, non il seq della risposta come diceva il piano (spec §6.1). Nessun costo osservato.
6. **I3: il riempimento del contesto è per singola richiesta, preso dall'ultimo evento `assistant`.** Se sbagliato, l'handoff scatta un po' dopo il 50%.
7. **Il tag di ogni messaggio è `m.model`, con `lastModel` come ripiego** (lo spec §7 prevale sul piano). Il costo è solo estetico.
8. **Ritocchi minori economici inclusi nel giro di correzioni finale:** errore azzerato, pulsanti disattivati durante la chiamata, README "on their next turn". Il costo è un diff un po' più grande.
9. **Scartato:** fare un secondo giro di correzioni sui minor rimasti. Restano nel registro come rimandati, vedi sotto.

## File toccati

Task 1–7: vedi `docs/handoff/2026-11-05-ark-phase1-step2.md`. Da lì in poi:

- **`src/shared/types.ts`:** `ArkApi.projects` e `ArkApi.threads`, più `contextUsed?` su `TurnResult` e sull'evento `turn`.
- **`src/preload/index.ts`:** i canali `projects:*` e `threads:*`, più `threads.onUpdate`.
- **`src/main/ipc/index.ts`:**
  - 11 handler con validatori: `uuid`, `messageText` da 1 a 100 000 caratteri, `agentIds` da 1 a 20 controllati con `AGENT_ID_RE`, `seq` ≥ 1, reazione 👍/👎;
  - `projects:git-init`.
- **`src/main/index.ts`:**
  - `ThreadStore` più `recover()`, e il `Conductor`;
  - `threads:update` inoltrato verso la finestra;
  - `conductor.stopAll()` prima di `runner.stopAll()`.
- **`src/main/services/threads/conductor.ts`:** il catalogo per il PM nuovo e la gestione degli id sconosciuti.
- **`src/main/services/threads/rules.ts`:** `needsHandoff(used, window)`.
- **`src/main/services/engines/claude-session.ts`:** `contextUsed` e la finestra presa dalla voce di `modelUsage` del modello. **`agent-runner.ts`:** passa `contextUsed`.
- **Nuovi nel renderer:**
  - `src/shared/thread-view.ts`: `actionable`, `reactionsOf`, `tokensByAgent`, `lastModel`, `mergeMessages`;
  - `src/renderer/hooks/useThreads.ts`, `pages/Threads.tsx`, `components/ThreadView.tsx`, `components/TeamPanel.tsx`.
- **Modificati nel renderer:**
  - `pages/Chat.tsx`: esporta `FIELD`, `BUTTON`, `CTA` e `tokenLine`; `BUTTON` prende `disabled:opacity-60`;
  - `agents.ts`, `App.tsx`, `pages/Usage.tsx`: il link Threads.
- **Test:**
  - `tests/shared/thread-view.test.ts`;
  - `tests/live/thread.live.test.ts`;
  - nuovi casi in `conductor.test.ts`, `claude-session.test.ts`, `thread-rules.test.ts`.
- **`README.md`:** la sezione `Threads`.

## Dove vogliamo andare

1. **Fai la prova manuale** (tocca all'utente, circa 10 minuti). Lancia `npm run dev`, poi:
   1. Add project su un repo di prova (anche Initialize Git su una cartella senza git) → nuovo thread → Approve team.
   2. Rispondi a un `@you` con un chip e metti 👍 a un messaggio.
   3. Arriva alla card del piano → Start developer.
   4. Chiudi Ark durante un turno e riaprilo. Controlla la nota `Ark was closed during a turn`, poi manda un messaggio e verifica che il thread continui.
   5. Avvia una seconda istanza: non deve partire, e deve tornare in primo piano la prima. Premi Ctrl+R: le chat si fermano, i thread no.
   6. Dopo l'uscita, `Get-Process claude,codex` deve essere vuoto.
2. **Se la prova passa:** committa i due handoff (`git commit -F`), poi `superpowers:finishing-a-development-branch` → push e PR su `main` con `gh pr create --body-file`. Nel corpo metti il riassunto, le decisioni qui sopra e i minor rimandati.
3. **Dopo il merge:** `rm -rf .superpowers/sdd/2026-11-05-phase1-step2-team-threads`.
4. **Poi il passo 3 della Fase 1** (build nel worktree). Porta con te i punti rimandati qui sotto.

## Da sapere prima di toccare qualcosa

- **Valgono ancora le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `~/.agents`, e mai leggere file di credenziali;
  - commit con `git commit -F <file>` e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - `npm test` non chiama mai un modello;
  - non allentare l'isolamento. Se `test:live` segnala una violazione, fermati.
- **Il registro** `.superpowers/sdd/2026-11-05-phase1-step2-team-threads/progress.md` ha tutte le righe `minor (deferred)` già smistate dalla revisione finale: nessuna blocca il merge. Quelle da portare nel passo 3:
  - `modelUsage`: il nome si confronta esatto, con ripiego sulla prima voce. Un nome con suffisso (`[1m]`) ricade sul ripiego; un confronto per prefisso lo chiuderebbe.
  - La fixture `claude-stream.jsonl` non ha `message.usage` sugli eventi `assistant`. Che `contextUsed` funzioni su uno stream vero non è dimostrato dai test unitari: se manca, si torna in silenzio al dato cumulativo. Va verificato su uno stream reale.
  - Le sessioni dei membri restano aperte fino all'uscita da Ark (c'è un commento `ponytail:`). Andrebbero fermate su wait/idle, visto che il replay esiste già.
  - Un messaggio dell'utente scritto durante un turno che poi fallisce non viene instradato: il thread va in `error`.
  - Una sessione morta tra un turno e l'altro produce un errore invece di ripartire da zero.
  - Non ci sono test sui validatori IPC: conviene estrarli in un `validate.ts` puro.
  - I componenti importano le costanti di stile da `pages/Chat`.
  - Restano le lacune di quoting in `spawnCommand` per i `.cmd`, e gli strumenti di rete e di pianificazione ancora attivi negli agenti read-only.
- **I thread di sviluppo salvati prima di `47fbf61`** possono avere card di team con id sconosciuti: si possono cancellare da `%APPDATA%\ark\threads`.
- **`orca computer`** non riesce a guidare il selettore di cartelle di Windows. Per questo la prova manuale tocca all'utente.
