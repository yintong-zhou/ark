---
type: handoff
date: 2026-11-05
status: in corso
seq: 4
prev: docs/handoff/2026-11-05-ark-phase1-step1-done.md
tags: [ark, electron, phase1, step2, threads, conductor, subagent-driven]
---

# Handoff — Ark Fase 1, passo 2 (thread col team), fermo prima del Task 8

## Obiettivo

Ark Fase 1: al posto di un solo Opus che fa tutto, un piccolo team di agenti lavora dentro un thread. Il motivo è il **costo**: i modelli economici fanno il lavoro facile, Opus solo quello difficile, e la qualità resta quella di oggi.

Il passo 2 aggiunge progetti e thread. Nel thread:
- il project manager propone il team e l'utente lo approva;
- il team pianifica, con il project manager che decide chi parla a ogni turno;
- gli agenti possono rivolgersi all'utente con `@you`;
- l'utente può reagire 👍/👎 ai messaggi;
- il piano finisce in una card con **Start developer**.

## A che punto siamo

- **Piano:** `docs/superpowers/plans/2026-11-05-phase1-step2-team-threads.md`, 10 task, esecuzione subagent-driven.
- **Branch:** `phase1-step2-team-threads`, creato da `4f48376` e mai pushato. HEAD `f38da04`, working tree pulito.
- **Task 1–7 fatti**, ognuno con la sua revisione e, dove serviva, un giro di correzioni con ri-revisione:
  1. una sola istanza dell'app, chat fermate al reload, rifiuto dei `CLAUDE.md` nelle cartelle sopra il progetto (`bfad194`);
  2. Codex ricontrolla skill e MCP a ogni turno; deduplica di `resolveRun`, `obj` e `AGENT_ID_RE` (`4fc4094`);
  3. `AgentRunner.turn()` restituisce `TurnResult` con `contextWindow`, e `stop()` rifiuta il turno pendente con `stopped` (`79407f7`);
  4. tipi in `src/shared/thread.ts` e `ThreadStore`, irrobustito contro righe troncate e thread rotti (`71cc8eb`, `51eeeab`);
  5. protocollo agenti in `threads/protocol.ts` (`a4a75e9`);
  6. regole dei turni in `threads/rules.ts` (`dc64e54`, `dc002a5`);
  7. `Conductor` in `threads/conductor.ts` (`78c51e5`, `f38da04`).
- **Verifiche:** `npm test` 258/258; typecheck e lint puliti.
- **Task 8 (IPC, preload, wiring):** fermato su richiesta dell'utente prima di qualsiasi modifica. Il brief è pronto.
- **Task 9 (schermata Threads) e Task 10** (test live, prova manuale, README, handoff): da fare.
- **Non ancora fatto:** l'app non è mai stata lanciata in dev su questo branch. La logica dei thread non è raggiungibile dalla UI finché il Task 8 non la collega.
- **Ancora aperto dal passo 1:** la prova della chat dalla UI (sceglie la cartella, avvia, invia) non l'ha fatta nessuno. La PR #3 (`phase1-engines-catalog`) è aperta e ha la descrizione compilata.

## Cosa abbiamo provato che NON ha funzionato

- **Regola del piano "cursore = seq della risposta dell'agente"** (Task 7, passi 5 e 6). Così l'agente perde i messaggi scritti mentre stava parlando. Il caso tipico: l'utente scrive al PM durante il turno del PM e il PM non lo vede mai. → Il cursore, e anche `handoffs[agent].seq`, ora puntano all'ultimo seq incluso nell'input di quel turno. `formatForAgent` salta comunque i messaggi dell'agente stesso.
- **Regola 2 di `afterReply` che esce subito con la correzione.** L'interruzione dell'utente veniva persa. → Ora, se c'è un'interruzione, vince lei: `turn` a `interrupt.to ?? PM`, con `retried` rimesso a false.
- **`validForManager` che accetta tutto in `build`/`done`.** Il PM poteva continuare a darsi la parola all'infinito, senza budget. → `afterReply` restituisce `idle` fuori da `team`/`planning`.
- **`afterUser` che non azzerava `summarizing`.** La risposta successiva del PM veniva presa per il riassunto. → Ora lo azzera.
- **Store fragile.** Un'append dopo una riga troncata incollava il messaggio nuovo alla riga rotta; un thread rotto faceva fallire `recover()` e quindi l'avvio dell'app; una riga JSON `null` rompeva `append`. → Ora l'append antepone `\n` se il file non finisce con un a capo, `recover()` ha un try/catch per ogni thread e le righe sono valide solo se sono oggetti con `seq` numerico.
- **Handoff fallito che mandava il thread in `error`.** Si perdeva la risposta buona appena salvata. → Ora si chiude la sessione, si aggiunge una nota e si prosegue con il passo previsto dalla risposta.

## Problemi incontrati e come li abbiamo risolti

- **Un'interruzione arriva mentre la risposta finisce in `wait`** (`ask`/`plan`/`team`): la regola 4 riscrive solo i passi `turn`. → Ruling: nel conductor, se dopo un `wait` c'è un'interruzione registrata, si applica subito `afterUser` e se ne esegue il passo. C'è un test per questo caso.
- **`turn()` va in timeout senza fermare la sessione.** → Il percorso di errore del conductor chiude sempre la sessione di quell'agente.

## Decisioni prese

- **Ripresa = replay.** Ogni sessione parte da zero: riceve il riassunto di passaggio, se c'è, più i messaggi successivi. Scartato il resume per id (`--resume`, `thread/resume`), mai verificato e diverso per ogni motore. È una deviazione dallo spec §11.
- **Lo storico in stile Slack** (`messages.jsonl`, solo in aggiunta) è la fonte di verità. La sessione del motore è una cache usa e getta. Scartato lo storico in stile Claude Code: troppi agenti e motori, file non di Ark, Auto cambia motore.
- **Rimandato su richiesta dell'utente:** gli aspetti Discord/Slack. Proposto un pulsante "Reset context" per agente, da riprendere più avanti. Scartati per ora i sotto-thread, la modifica dei messaggi e i non-letti.
- **Il piano** vive in `<userData>/threads/<id>/plan.md`, non nel worktree, che arriva con il passo 3. Start developer per ora registra solo l'approvazione.
- **Project manager** = l'agente del catalogo con id `project-manager`.
- **I `team` e `next` scritti da un membro si ignorano** e la parola torna al PM, perché è solo il PM a scegliere chi parla.
- **La nota "non valido" usa l'id dell'agente,** non il nome: le regole sono pure e non conoscono i nomi.
- **Rimandati al passo 3:** le lacune di quoting in `spawnCommand` per i `.cmd`; gli strumenti di rete e di pianificazione ancora attivi negli agenti read-only.

## File toccati

- `src/main/index.ts`: lock di istanza singola e `second-instance`.
- `src/main/ipc/index.ts`: chat fermate su `did-start-loading`; `AGENT_ID_RE`.
- `src/main/services/engines/isolation.ts`: `ancestorInstructions`; usa `obj` da `../json`.
- `src/main/services/agent-runner.ts`:
  - rifiuta i `CLAUDE.md` negli antenati;
  - `forbidden` per cartella e per nome;
  - `turn()`, la mappa `pending`, `oneShot` riscritto sopra `turn`.
- `src/main/services/engines/codex-session.ts`: ricontrollo skill e MCP a ogni turno; `contextWindow`.
- `src/main/services/engines/claude-session.ts`: `contextWindow` da `modelUsage`.
- `src/shared/agent-problems.ts` (ora contiene `resolveRun`), `src/main/services/engines/models.ts` (lo riesporta), `src/shared/agent-file.ts` (`AGENT_ID_RE`), `src/main/services/catalog.ts`.
- `src/shared/types.ts`: `TurnResult`; `contextWindow` sull'evento `turn`.
- Nuovi:
  - `src/shared/thread.ts`;
  - `src/main/services/threads/store.ts`, `protocol.ts`, `rules.ts`, `conductor.ts`;
  - test: `tests/main/thread-store.test.ts`, `thread-protocol.test.ts`, `thread-rules.test.ts`, `conductor.test.ts`.
- Anche il logo: `resources/icon.png` e `resources/logo.png`, `electron-builder.yml`. Questo commit è sul branch del passo 1 ed è già nella PR #3.

## Dove vogliamo andare

1. **Riprendi dal Task 8.** Leggi il registro `.superpowers/sdd/2026-11-05-phase1-step2-team-threads/progress.md`: le righe di stato dicono che i task 1–7 sono completi, e ci sono i ruling e i punti minori rimandati. Riapri `superpowers:subagent-driven-development`, lancia di nuovo il Task 8 dal brief già pronto `task-8-brief.md`, con base `f38da04`. Ricorda all'implementatore che IPC deve rifiutare il testo vuoto (da 1 a 100 000 caratteri) in `threads:create` e `threads:send`, perché il conductor non lo fa.
2. Poi il Task 9 (la schermata Threads) e il Task 10 (`npm run test:live` con il thread su haiku, la prova manuale fatta dall'utente, README, nuovo handoff).
3. Revisione finale dell'intero branch su Opus. Passale le righe `minor (deferred)` del registro. Poi `superpowers:finishing-a-development-branch` e la PR.

## Da sapere prima di toccare qualcosa

- **Regole sempre valide:**
  - mai scrivere in `~/.claude`, `~/.codex` o `~/.agents`, e mai leggere file di credenziali;
  - commit con `git commit -F <file>` e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - `npm test` non chiama mai un modello.
- **Isolamento:** non allentare `claudeArgs`, `CODEX_BASE_ARGS` o i controlli. Se `test:live` segnala una violazione, fermati.
- **Workspace SDD:** `.superpowers/sdd/…` è ignorato da git. Un `git clean -fdx` lo cancella: in quel caso ricostruisci da `git log`.
- **Il Task 1 non è mai stato provato in dev:** l'istanza singola e il comportamento al reload vanno verificati nella prova manuale del Task 10.
- **Test e `CLAUDE.md`:** i test del runner danno per scontato che non ci sia un `CLAUDE.md` in `%TEMP%` né nelle cartelle sopra.
