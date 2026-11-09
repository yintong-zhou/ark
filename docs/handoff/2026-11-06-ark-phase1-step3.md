---
type: handoff
date: 2026-11-06
status: in-corso (Task 1–6 fatti e revisionati, mancano Task 7–9 e la review finale)
seq: 1
prev: docs/handoff/2026-11-05-ark-phase1-step2-done.md
tags: [ark, electron, phase1, step3, build, worktree, approvals, subagent-driven]
---

# Handoff - Ark Fase 1, passo 3 (fasi di build), interrotto dopo il Task 6

## Obiettivo

Ark fa lavorare un piccolo team di agenti in un thread al posto di un solo Opus. Il motivo è il costo: i modelli economici fanno il lavoro facile, e la qualità deve restare quella di oggi.

Il passo 3 aggiunge la build:
- **Start developer** crea un worktree Git su un branch `ark/…`;
- il developer costruisce il piano fase per fase;
- ogni fase passa da sviluppo → check → code review → security review;
- dopo 2 giri senza accordo, il PM tagga l'utente;
- le azioni rischiose passano da una card Allow/Deny;
- alla fine, un riepilogo.

Spec: `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`, sezioni §6.1, §6.4 e §8.3. Piano: `docs/superpowers/plans/2026-11-06-phase1-step3-build-phases.md`.

## A che punto siamo

- **Branch:** `phase1-step3-build-phases`, partito da `main` (`c1b0746`), HEAD `3c0d6f9`, non pushato. Il working tree è pulito, a parte questo handoff (non tracciato).
- **Esecuzione:** subagent-driven, scelta dall'utente.
- **Ledger** (la fonte di verità per riprendere): `.superpowers/sdd/2026-11-06-phase1-step3-build-phases/progress.md`. È git-ignorato e sta sul disco. Contiene la tabella del controllo preliminare, le rulings R1–R8, i minor rimandati e le note per la review finale.
- **Fatti, committati e revisionati:**

  | Task | Contenuto | Commit |
  |---|---|---|
  | 1 | `workspace.ts`: Git e check nel worktree | `f053073` |
  | 2 | tipi condivisi di build | `48e828b` |
  | 3 | protocollo di build, blocco `review`, `parsePhases` | `b637453` |
  | 4 | profilo `build` e approvazioni su Claude e Codex | `cb68c2f` e la correzione `51dc9c4` |
  | 5 | `build-rules.ts`, la macchina a stati pura | `c3d29a8` |
  | 6 | conductor: avvio del worktree, ciclo di build, approvazioni | `ffb24f3` e la correzione `3c0d6f9` |

- **Verde all'ultimo giro:** `npm test` 357/357, typecheck e lint.
- **Interrotto dall'utente ("ferma tutto"):** l'agente che faceva insieme i Task 7 e 9 (IPC + card). Si è fermato prima di scrivere qualcosa, e il working tree è stato verificato pulito. Nel ledger l'ultima riga è `Task 7+9: STOPPED`.
- **Non iniziati:**
  - Task 7: `threads:answer` in IPC e preload, `ArkApi`;
  - Task 8: test live sugli engine veri, a pagamento ma sul tier light;
  - Task 9: `PhaseCard`, `ApprovalCard`, il badge `needsYou`;
  - la review finale del branch, poi finishing-a-development-branch.

## Cosa abbiamo provato che NON ha funzionato

- **`claude -p` stream-json senza flag:** nega da solo tutto ciò che chiederebbe un permesso (`This command requires approval`), e Ark non vede niente. → Serve `--permission-prompt-tool stdio`. Con quello arriva il `control_request` `can_use_tool` e si risponde con un `control_response`. Il deny è verificato dal vivo. L'allow non è ancora confermato: il comando di prova (`node --version`) non chiedeva il permesso. Lo verifica il Task 8.
- **Applicare `agent.permissions` in ogni `startAgent`** (prima versione del Task 4). Un agente `build` aperto nella chat semplice avrebbe modificato il checkout reale con `acceptEdits`, e le sue approvazioni sarebbero rimaste appese. → R3: `startAgent(agent, dir, permissions = 'read-only')`. È il chiamante a scegliere, e solo il developer in fase di build passa `'build'`.
- **Card file-change di Codex con `reason` prima di `grantRoot`.** Mostrava la spiegazione del modello invece della cartella a cui si dà accesso. → R4: prima `grantRoot`, poi `(reason)`.
- **Avvio della build non riprendibile** (prima versione del Task 6). Se `commitAll` falliva dopo `addWorktree` (identità Git mancante, un hook), ogni nuovo tentativo moriva su "already exists". → Se il worktree esiste e ha un HEAD, si riusa.
- **Errori Git attribuiti all'agente.** Il catch scriveva "Developer stopped: <errore git>" e buttava la sua sessione. → `speaking` si azzera prima di `commitAll`, dei check e di `diff`, e la nota diventa "The build stopped: …".

## Problemi incontrati e come li abbiamo risolti

- **`node_modules` mancava nel repo.** Il primo implementer ha lanciato `npm ci`. npm ha avvisato che gli install script di `electron-winstaller` ed `esbuild` non sono coperti da `allowScripts`, e non li ha approvati. → Prima di `npm run dev` o della prova CDP, controlla che il binario di Electron ci sia: `node_modules/electron/dist/electron.exe`.
- **Commit con trailer di modello diversi.** I subagent Haiku e Sonnet firmano con il proprio modello. Ruling: va bene, è un'attribuzione vera.

## Decisioni prese

Sono le rulings del ledger. Vanno riportate tutte all'utente a fine lavoro, sotto "Rulings I made".

- **R1:** un `plan` senza intestazioni di fase è un blocco non valido e riceve una correzione. Sta nel conductor (Task 6). Scartato: lasciarlo passare e fallire solo a Start developer.
- **R2:** il test di Start developer cerca la chiamata `addWorktree` con `find`, perché `head()` viene chiamato prima.
- **R3:** sola lettura di default, `build` solo per il developer nel worktree. Scartato: rispettare `permissions: build` anche nella chat semplice.
- **R4:** la card di Codex mostra prima `grantRoot` e poi il motivo.
- **R5, R7:** i minor economici sono entrati nei giri di correzione dei Task 4 e 6.
- **R6:** la nota d'avvio mostra lo sha di HEAD del progetto, non il commit del piano. È più chiaro accanto a "uncommitted changes are not included".
- **R8:** i Task 7 e 9 vanno in un solo invio e una sola review, perché la card chiama direttamente l'IPC.
- **Accettato:** `AppServerClient.onRequest` ha un quarto argomento, l'id rpc, che serve all'id dell'approvazione di Codex.
- **Accettato così com'è (concern 3 del Task 6):** un messaggio dell'utente durante un turno del manager in build viene solo accodato e non sblocca la wait successiva. Lo dice il piano.

## File toccati

- **Nuovi:**
  - `src/main/services/threads/workspace.ts` (+ `tests/main/workspace.test.ts`): Git nel worktree, check `npm run`, `branchName`;
  - `src/main/services/threads/build-rules.ts` (+ `tests/main/build-rules.test.ts`): la macchina a stati della build.
- **`src/shared/thread.ts`:**
  - i tipi `Build`, `BuildPhase` e `PhaseStep`;
  - le costanti `REVIEW_ROUNDS`, `BUILD_TURN_MS` e `BUILD_ROLES`;
  - i messaggi `phase`, `approval` e `decision`, e il controllo `review`;
  - `Thread.build` e `Thread.approvals`.
- **`src/main/services/threads/protocol.ts`:**
  - `DEVELOPER_PROTOCOL` e `REVIEWER_PROTOCOL`, e `withProtocol(agent, phase)`;
  - `parsePhases`, il blocco `review` e `DIFF_MAX`;
  - le nuove `NOTES`;
  - i finding visibili in `formatForAgent`.
- **`src/main/services/threads/conductor.ts`:**
  - `startDeveloper` async, con worktree, commit del piano e ruoli aggiunti;
  - `runBuild` e l'helper `speak()` condiviso con `run()`;
  - `answer` e l'instradamento delle approvazioni;
  - R1.
- **`src/main/services/threads/store.ts`:** `recover` azzera `approvals`.
- **Engine:**
  - `src/shared/types.ts`: `ChatEvent` `approval`;
  - `engines/session.ts`: `answer`;
  - `engines/isolation.ts`: `claudeArgs` con `permissions`, e la whitelist `--tools`;
  - `engines/claude-session.ts`: `can_use_tool`, e `modelUsage` con match esatto prima;
  - `engines/app-server-client.ts`: `onRequest`;
  - `engines/codex-session.ts`: `workspace-write` / `on-request` e le approvazioni;
  - `agent-runner.ts`: `answer`, e `startAgent(…, permissions)`.
- **Ritocchi minimi:**
  - `src/shared/chat-log.ts`;
  - `src/shared/thread-view.ts` (`startsGroup`);
  - `src/renderer/components/ThreadView.tsx`: filtro provvisorio sui nuovi tipi;
  - `src/main/index.ts`: `workspace` e `worktrees` passati al conductor;
  - `tests/live/engines.live.test.ts` e `tests/live/thread.live.test.ts`.
- **Test estesi:**
  - `conductor.test.ts`, `thread-store.test.ts`, `thread-protocol.test.ts`;
  - `isolation.test.ts`, `claude-session.test.ts`, `codex-session.test.ts`, `agent-runner.test.ts`.

## Dove vogliamo andare

1. **Riprendi subagent-driven development** con la skill `superpowers:subagent-driven-development` sullo stesso piano. Il workspace è `.superpowers/sdd/2026-11-06-phase1-step3-build-phases/`. Fidati del ledger e di `git log`, e non rilanciare i Task 1–6.
2. **Rilancia i Task 7+9 in un solo invio** (Sonnet).
   - Il brief combinato c'è già: `task-7-9-brief.md`. Ci sono anche `ui-profile-notes.md` (come guardare la UI su un profilo a parte), `context.md` e `reviewer-instructions.md`.
   - BASE `3c0d6f9`.
   - Ruling da ripetere nell'invio: in `ThreadView` si passa a un filtro positivo (disegna `phase` e `approval`, nasconde `decision`).
   - Poi la review (Sonnet) con `review-package`.
3. **Task 8, i test live** (Sonnet). Brief da estrarre con `task-brief … 8`. Ricorda:
   - deve confermare la forma della risposta `allow` di Claude e `contextUsed` su uno stream vero;
   - deve verificare che con `--tools Read,Glob,Grep,Skill` le skill si carichino ancora;
   - deve verificare che Codex chieda l'approvazione per `curl`;
   - se c'è una violazione d'isolamento, fermati e riferisci.
4. **Review finale** su Opus, con il package `c1b0746..HEAD`. Indicale nel ledger le righe `minor (deferred)` e le due `FINAL-REVIEW NOTE`:
   - `--setting-sources project` lascia approvare tool alle regole `allow` del progetto;
   - gli hook Git del progetto girano a ogni `commitAll`.

   Poi un solo giro di correzioni e una re-review.
5. **Fine:**
   - riporta all'utente tutte le rulings del ledger;
   - cancella il workspace `.superpowers/sdd/2026-11-06-phase1-step3-build-phases`;
   - lancia `superpowers:finishing-a-development-branch`;
   - scrivi l'handoff `-done`, con la prova manuale per l'utente (piano, Task 10).

## Da sapere prima di toccare qualcosa

- **Valgono le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `~/.agents`, e mai toccare `%APPDATA%\ark`, dove ci sono progetti veri;
  - commit con `git commit -F .tmp/msg.txt` e il trailer `Co-Authored-By`;
  - `npm test` non chiama mai un modello.
- **Non mandare messaggi a un thread in fase team o planning su un profilo vero:** lancia un agente a pagamento. Per guardare la UI usa un profilo a parte (`ui-profile-notes.md`).
- **I subagent vanno lanciati sempre con il modello esplicito.** Reviewer Sonnet; Opus per le parti di sicurezza o integrazione e per la review finale.
- **Il ledger è git-ignorato.** `git clean -fdx` lo cancella. In quel caso si ricostruisce da `git log` e da questo file.
- **Il piano dice "Decisions taken here"** in testa. `context.md` nel workspace è la copia che si passa ai subagent.
