---
type: handoff
date: 2026-11-06
status: fatto (passo 4 su main, non pushato; la Fase 1 è completa)
seq: 3
prev: docs/handoff/2026-11-06-ark-phase1-step3-done.md
tags: [ark, electron, phase1, step4, auto-routing, cost, rate-limits, done]
---

# Handoff — Ark Fase 1, passo 4 (routing Auto e costi), completato

## Obiettivo

Ark fa lavorare un team di agenti in un thread al posto di un solo Opus, per spendere meno a parità di qualità. Il passo 4 chiude la Fase 1 con due cose:
- **routing Auto** (spec §7): i lavori leggeri vanno sui modelli economici, e quando Claude è al limite il lavoro light e standard passa a Codex;
- **costi onesti** (spec §9): token per agente e per modello, e movimento delle finestre 5h e settimanale durante il thread, sempre "including your other sessions".

Spec: `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`, §7 e §9. Piano: `docs/superpowers/plans/2026-11-06-phase1-step4-auto-routing-cost.md`.

## A che punto siamo

- **Branch.** `phase1-step4-auto-routing-cost` è stato unito su `main` in fast-forward (`cc476be..868a6eb`, 10 commit), poi cancellato. `main` è **10 commit avanti a `origin/main`**: non è pushato.
- **Controlli.** Su `868a6eb` passano typecheck, lint, `npm test` (422/422) e `npm run build`.
- **Test live.** `npm run test:live -- -t "usage window"` è passato (lanciato dall'utente). La forma di `rate_limit_event` è quindi confermata: `utilization` è una frazione e `resetsAt` è in secondi.
- **Visto nell'app.** Sulla build, con un profilo di prova e un thread finto, via CDP:
  - il blocco "Thread cost" mostra i token per modello, le righe `Claude 5h 41% → 44%` e "Including your other sessions";
  - la nota di reroute compare nel thread.
- **Cosa è entrato:**
  - **Regola Auto.** In `src/shared/agent-problems.ts`:
    - `tierUp`;
    - `SWITCH_AT = 90`;
    - `claudeLimited(st, nowSec)`, dove una finestra scaduta non conta;
    - `resolveRun(agent, installed, claudeLimited)`: un agente `auto` con tier light o standard va su Codex, se è installato, con `rerouted: true`.
  - **Runner.** `RunnerDeps.claudeLimited` e `ChatStarted.rerouted`.
  - **Finestre dalle sessioni di Ark.** Il `ChatEvent` `limits` viene da:
    - `rate_limit_event`, letto da `claudeRateLimit` in `claude-session.ts` (`five_hour` = 300, `seven_day` = 10080, gli altri tipi vengono ignorati);
    - `account/rateLimits/updated` in `codex-session.ts`.

    `main/index.ts` lo passa a `usage.apply`.
  - **Flag hard.** Con `{"next":…,"hard":true}` del PM, quel turno gira a `tierUp(tier)` in una sessione nuova, che poi viene chiusa. La regola sta in `rules.ts` e `protocol.ts`, il resto in `conductor.run`. Se non c'è un tier da guadagnare (agente heavy o con modello fissato), la sessione resta quella di prima.
  - **Switch sulle sessioni vive.** In `conductor.speak`, un agente `auto` non heavy:
    - su Claude passa a Codex al turno dopo, quando Claude è limitato;
    - se era stato spostato, torna su Claude sotto il 90%.

    Le eccezioni:
    - **build:** le sessioni di build non vengono mai riavviate dallo switch;
    - **set `stuck`:** una chat partita su Claude quando Claude era già limitato (cioè senza Codex) resta dov'è.
  - **Movimento delle finestre.** `Thread.windows` (`ThreadWindows`, `WindowMove`) viene registrato da `moveWindows` in `usage-math.ts`, prima e dopo ogni turno, per l'engine del turno. Al reset riparte da 0%.
  - **Nota di reroute** (`NOTES.rerouted`) quando una sessione nuova parte spostata.
  - **Costi a schermo.** Il blocco "Thread cost" in `TeamPanel.tsx` usa `tokensBy` e `windowLines` di `thread-view.ts`. Il riepilogo di build (`NOTES.summary`) riporta i token per agente e modello e le righe delle finestre.
  - **Documentazione e test live:** README (bullet Auto e Thread cost) e il test live `a Claude turn reports its usage window`.

## Cosa abbiamo provato che NON ha funzionato

- **Applicare lo switch al 90% solo in `startAgent`** (prima versione del Task 1). Le sessioni del conductor restano aperte per molti turni, quindi PM e planner restavano su Claude anche al 95% e fallivano al 100%. → Lo switch va controllato anche quando si riusa una sessione viva, in `speak`.
- **Far cadere la sessione viva senza eccezioni** (prima correzione, `bbb7204`). Ha portato due regressioni:
  - una sessione di build riavviata saltava `claudeSettingsProblem`, perché `runBuild` controlla il file solo quando il developer non ha una sessione. Un `settings.json` scritto dal developer avrebbe agito senza card. → Lo switch non tocca le sessioni di build (`!o.build`).
  - senza Codex installato e con Claude limitato, la sessione si riavviava a ogni turno, con il replay completo del transcript pagato da una finestra già al 90%. → Set `stuck`.
- **Un test di build "rosso" che passava per caso.** Il developer del seed ha il modello fissato ed è heavy, quindi lo switch non lo toccava comunque. → Nel test il developer va messo `auto` / `standard`.
- **Scrivere un file con un heredoc in Bash** (il brief di una correzione). Il comando non ha dato errori ma il file non c'era. → Per i file usa lo strumento Write.

## Problemi incontrati e come li abbiamo risolti

- **Comando Bash composto negato.** `git switch` più commit più uno script esterno in un'unica riga sono stati rifiutati dai permessi. → Lancia i comandi uno alla volta.
- **Screenshot dell'app.** Questa volta l'accesso a `node_modules\electron\dist` era consentito, e la ricetta del vecchio handoff ha funzionato:
  - `npm run build`;
  - `ELECTRON_RENDERER_URL= node_modules/.bin/electron . --user-data-dir=<profilo nello scratchpad> --remote-debugging-port=9333`;
  - uno script Node che usa `fetch` e `WebSocket` globali, clicca il thread nella sidebar (`Runtime.evaluate`) e chiama `Page.captureScreenshot`.

  Il profilo finto si costruisce scrivendo `projects.json` e `threads/<uuid>/{thread.json,messages.jsonl}`. Gli id dei thread devono essere UUID.
- **Processi rimasti aperti.** `TaskStop` sul processo in background non chiude i figli: restano 4 `electron.exe`. → `Get-CimInstance Win32_Process -Filter "Name='electron.exe'"`, filtra su `CommandLine -like '*ark-profile*'`, poi `Stop-Process`.
- **Implementer che edita con Python.** Riscrive i file con LF, e Git avvisa della normalizzazione CRLF; il diff resta corretto. → Nel brief chiedi di usare gli strumenti di modifica e di mantenere le terminazioni di riga.

## Decisioni prese

- **Tabella dei tier = i tier degli agenti** (scelta dell'utente). I seed codificano già §7: manager light, planner standard, reviewer standard, developer heavy. *Scartata:* una seconda tabella "per tipo di lavoro", che potrebbe contraddire il form dell'agente.
- **Hard = sessione nuova** (scelta dell'utente). *Scartata:* cambiare modello nella stessa sessione, perché gli engine non lo permettono a metà sessione.
- **Finestre anche da `rate_limit_event` e `account/rateLimits/updated`** (scelta dell'utente). *Scartato:* usare solo `UsageService` di prima, dove senza status line lo switch di Claude non scatta mai.
- **R1:** `moveWindows` ignora una lettura di una finestra più vecchia di quella salvata, come fa `mergeWindow`. Se è sbagliata: una lettura vecchia viene scartata.
- **R2/R4:** il test live si lancia solo con l'ok dell'utente. Fatto: passato.
- **R3:** niente riga di stato nell'header del thread (§9). Ripete la barra di stato globale e il pannello del team, e "agents running" vale sempre 0 o 1. L'utente ha approvato il piano che la escludeva. *Da aggiungere* se arrivano turni paralleli.
- **R5:** restano come sono due imprecisioni solo di visualizzazione:
  - una lettura con una sola finestra rinfresca `updatedAt` anche per l'altra, nella schermata Usage;
  - la prima lettura di un thread può essere vecchia.
- **R6:** un secondo giro di correzioni oltre l'unico previsto dal processo SDD, perché la prima correzione scavalcava la card di approvazione.
- **Al reset di una finestra il movimento riparte da 0%.** È un `ponytail:`: si perde il movimento dentro la finestra precedente. *Scartata:* tenere una lista di finestre per thread.
- **Lo switch non riavvia le sessioni di build.** Ripartono sull'engine giusto al prossimo avvio fresco, cioè per fase e per review. *Scartato:* rifare il controllo `claudeSettingsProblem` dentro `speak`.

## File toccati

- `src/shared/agent-problems.ts`: `tierUp`, `SWITCH_AT`, `claudeLimited`, `resolveRun` con lo switch.
- `src/shared/types.ts`: `ChatStarted.rerouted` e il `ChatEvent` `limits`.
- `src/shared/thread.ts`: `Control.next.hard`, `WindowMove`, `ThreadWindows`, `Thread.windows`.
- `src/shared/usage-math.ts`: `moveWindows`.
- `src/shared/thread-view.ts`: `tokensBy`, `windowLines`.
- `src/shared/chat-log.ts`: ignora `limits`.
- `src/main/services/agent-runner.ts`: `claudeLimited` nelle dipendenze e `rerouted` nel risultato.
- `src/main/services/engines/claude-session.ts`: `claudeRateLimit` e il ramo `rate_limit_event`.
- `src/main/services/engines/codex-session.ts`: il ramo `account/rateLimits/updated`.
- `src/main/services/threads/rules.ts`: `Step.hard`.
- `src/main/services/threads/protocol.ts`:
  - la riga `hard` in `MANAGER_PROTOCOL`;
  - il parse di `hard`;
  - `NOTES.rerouted`;
  - `NOTES.summary` con le finestre.
- `src/main/services/threads/conductor.ts`:
  - le mappe chat → engine, `rerouted` e `stuck`, pulite in `stopChat`;
  - lo switch sulle sessioni vive;
  - il turno hard;
  - `moveWindows` intorno a `runner.turn`;
  - la nota di reroute;
  - le righe del riepilogo.
- `src/main/index.ts`: collega `claudeLimited`, `windows` e il passaggio di `limits` a `usage.apply`.
- `src/renderer/components/TeamPanel.tsx`: il blocco "Thread cost".
- `README.md`: i bullet Auto e Thread cost.
- `tests/…`:
  - unit test in `agent-problems`, `models`, `agent-runner`, `claude-session`, `codex-session`, `usage`, `thread-protocol`, `thread-rules`, `conductor`, `usage-math`, `thread-view`;
  - il test live in `tests/live/engines.live.test.ts`;
  - i fake aggiornati negli altri test live.
- `docs/superpowers/plans/2026-11-06-phase1-step4-auto-routing-cost.md`: il piano.

## Dove vogliamo andare

1. Pusha `main` (`git push`), quando l'utente lo chiede.
2. Fai la prova manuale completa della Fase 1 (spec §13), su un repo usa-e-getta e mai su un progetto vero:
   - un thread dalla proposta del team al riepilogo finale;
   - il branch principale resta intatto;
   - il blocco Thread cost è visibile;
   - la lista della prova manuale nell'handoff del passo 3 resta valida (card, badge, I1–I4).
3. Poi apri la **Fase 2 — File editor e terminale** (`PROJECT.md`, tabella delle milestone): brainstorming, spec, piano.
4. **Minor rimandati**, a bassa priorità, da fare quando si tocca la zona:
   - il test di pausa del turno hard non verifica lo stop della chat heavy;
   - `tierOf` duplica una query nei test del conductor;
   - una lettura persa quando un turno lancia un errore o Ark si chiude a metà;
   - `moved()` riassegna `t` dentro un `&&`;
   - la nota di reroute si ripete a ogni sessione fresca spostata;
   - le righe delle finestre restano nascoste finché nessun messaggio ha un modello;
   - la chiave agente+modello è unita con `\n` (un modello vuoto stampa "Name ()");
   - nessun test sul passaggio di `windowLines(t.windows)` al riepilogo;
   - le righe dei modelli usano l'id grezzo come chiave e `shortModel` come testo;
   - nel test live, il commento sul `forbidden` vuoto;
   - il ramo `rate_limit_event` viene prima del controllo di init;
   - una chat `stuck` non si sposta se Codex viene installato mentre la sessione è aperta.
5. **Domanda aperta (spec §15):** il test live conferma almeno una finestra con la percentuale, non che 5h e settimanale arrivino sempre entrambe.

## Da sapere prima di toccare qualcosa

- Valgono le regole di sempre:
  - mai scrivere in `~/.claude`, `~/.codex`, `~/.agents` o `%APPDATA%\ark`; per provare l'app usa un `--user-data-dir` a parte;
  - commit con `git commit -F`;
  - `npm test` non chiama mai modelli;
  - `npm run test:live` costa token: chiedi prima.
- Se tocchi lo switch in `conductor.speak`, non togliere `!o.build`: è quello che garantisce che una sessione di build nuova passi sempre da `claudeSettingsProblem`.
- `claudeLimited` e `windows('claude')` leggono entrambi `usage.get()`, così runner e conductor non sono mai in disaccordo e la sessione non oscilla tra i due engine.
- Il workspace SDD di questo piano è stato cancellato: la storia è in Git e in questo file.
