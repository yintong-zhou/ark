---
type: handoff
date: 2026-11-05
status: pronto per review
seq: 3
prev: docs/handoff/2026-11-05-ark-phase1-step1.md
tags: [ark, electron, phase1, agent-teams, isolation, claude-code, codex]
---

# Handoff - Ark Fase 1, passo 1 completato

## Obiettivo

Ark Fase 1: al posto di un solo Opus che fa tutto, un piccolo team di agenti lavora in un thread. Ogni agente ha il suo ruolo, il suo modello e **solo le sue skill**. Il motivo principale è il **costo**: i modelli economici fanno il lavoro facile e Opus solo quello difficile, con la stessa qualità di oggi.

Il passo 1 serve a scegliere un agente dal catalogo e chattarci su Claude Code o Codex, con l'isolamento verificato su entrambi i motori. Il passo 1 è **finito**.

## A che punto siamo

- **Branch `phase1-engines-catalog`:** 28 commit sopra `main`, working tree pulito, non pushato. HEAD `d840e36`.
- **Piano eseguito per intero** (Task 1→12, subagent-driven). Ogni task ha avuto la sua revisione, poi c'è stata una revisione finale del branch su Opus, con un giro di correzioni (F1–F10) e una ri-revisione pulita.
- **Verde:**
  - typecheck, lint e build;
  - `npm test`: 176/176;
  - `npm run test:live`: 2/2, senza violazioni.
- **Isolamento dal vivo:**
  - Claude vede solo `ark-agent:<skill>` più 19 built-in, nessun MCP, e i suoi `init.tools` non contengono Edit, Write, NotebookEdit, Bash o PowerShell.
  - Codex ha abilitate solo le skill private.
- **Prova end-to-end** con i motori veri (script in `.tmp/e2e/manual.test.ts`, gli stessi servizi che collega `index.ts`):
  - Planner su Claude: 2 turni su `claude-sonnet-5-5`, con memoria tra i turni e token;
  - sonda sull'auto-memory in `D:\DEVS\ark`: risponde "NO";
  - Code reviewer su Codex: `gpt-6.1-terra`;
  - bozza con AI valida;
  - import di `code-reviewer` da agent-skills.
- **Pulizia:** dopo la chiusura nessun processo `claude`/`codex`/`electron` orfano, e `~/.claude/settings.json` e `~/.codex/config.toml` hanno lo stesso hash.
- **Non fatto:** la prova della chat **dalla UI** (scegli cartella → Start chat → Send). Lo strumento `orca computer` non riesce a scrivere nel selettore di cartelle di Windows. In dev si è visto solo che la schermata Agents (7 agenti di partenza, motori CC/CX) e la schermata Chat prima dell'avvio vengono renderizzate.
- **Non verificato:** l'esclusione di `~/.claude/CLAUDE.md` tramite `--setting-sources`, perché il file non esiste su questa macchina.

## Cosa abbiamo provato che NON ha funzionato

- **`--setting-sources project,local` per Claude.** `local` è lo strato personale per progetto (`.claude/settings.local.json`): contiene i permessi "non chiedere più" dell'utente e possibili hook. → Usare solo `--setting-sources project`.
- **`--disallowedTools Edit Write NotebookEdit Bash` per avere un agente read-only.** Su Windows Claude Code ha anche lo strumento `PowerShell`, attivato da un flag lato server o se manca Git Bash. → Aggiungere `PowerShell`. Non usare `CLAUDE_CODE_USE_POWERSHELL_TOOL=0`: senza Git Bash Claude esce con "requires a shell tool".
- **Fidarsi di `cleanEnv` per isolare Claude.** L'auto-memory (`~/.claude/projects/<slug>/memory/MEMORY.md`) si carica lo stesso, e `system/init` non la mostra, quindi il controllo non la vede. → `claudeEnv()` aggiunge `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- **Ignorare `~/.codex/AGENTS.md` perché oggi non esiste** (era la regola R5). Così l'isolamento fallisce aperto appena l'utente crea il file. → Se esistono `AGENTS.md` o `AGENTS.override.md` in codexHome, `IsolationError` e la chat non parte. Inoltre Codex ha la feature `memories` (`codex features list`: `memories stable false`). → `--disable memories` in `CODEX_BASE_ARGS`.
- **`child.kill()` su un motore `.cmd` (npm).** Uccide solo `cmd.exe` e il motore resta vivo. → `taskkill /pid <pid> /T /F`, ma solo se il processo è ancora vivo, perché il pid potrebbe essere stato riassegnato.
- **`cpSync(..., {recursive:true})` per copiare le skill.** Non segue i symlink: la cartella privata diventava un link a quella dell'utente. → `dereference: true`.
- **Guidare con `orca computer` il selettore di cartelle nativo.** La tastiera viene rifiutata (`window_not_focused`, perché il dialog modale non è la finestra target) e i clic a coordinate cadono fuori posto (la finestra si sposta tra uno screenshot e l'altro). → Navigare nell'app con Tab e Invio funziona, e un clic per indice di elemento chiude il dialog. Per la chat dalla UI serve una persona.
- **Nella UI, mappare un rifiuto `busy` di `chat.send` su un errore.** L'errore rimetteva `busy` a false a metà turno. → I rifiuti `busy` si ignorano.

## Problemi incontrati e come li abbiamo risolti

- **Uno spawn fallito (ENOENT) faceva crashare il main process.** Causa: l'evento `error` non era gestito. Fix: `nodeSpawn` lo trasforma in un'uscita con codice `null` e il messaggio in stderr.
- **Output del motore prima di `system/init`.** Arrivava all'utente, oppure lasciava `busy` bloccato. Fix: la sessione si ferma con un errore `isolation` e il messaggio "no init event".
- **`rmSync` dava EPERM su Windows subito dopo il kill del motore.** Fix: la pulizia è best-effort, con `maxRetries` e try/catch.
- **"Add manually" cancellava `codex.tiers` da `engines.json`.** Fix: `mergeEngines` in main, e il renderer manda solo il motore modificato.
- **Doppio clic o Back durante `chat.start` lasciavano un motore orfano.** Fix: stato `starting` e un ref `mounted`; un avvio che risolve dopo l'unmount chiama `chat.stop`.
- **Limite delle 5 ore di Claude raggiunto a metà sessione.** Un subagente si è fermato. Fix: dopo il reset l'ho ripreso con `SendMessage`, senza rilanciarlo.

## Decisioni prese

- **Isolamento: fallisce chiuso ovunque.** Init malformato, output prima di init, `config/read` malformato e skill o MCP non attesi → la sessione si ferma. Scartato: tollerare e loggare.
- **Turni falliti.** Un turno Claude non `success` emette solo `error` (niente `turn`), come Codex, così `oneShot` può rifiutare. Scartato: emettere entrambi, perché `oneShot` si sarebbe risolto sul `turn` e avrebbe perso l'errore.
- **Skill su Codex: si riconoscono dalla cartella**, non dal `name` nel frontmatter. Scartato il nome, che può differire e darebbe falsi fallimenti.
- **Log di sessione dei motori** (`~/.codex/sessions`, `~/.claude/projects`): restano, niente `ephemeral`. Il vincolo "non scrivere in ~/.codex" vale per le scritture di Ark. Effetto collaterale: Usage mostra molte sessioni "codex-project" create dai test dal vivo.
- **Nuovo agente con lo stesso id di uno esistente:** il form blocca Save. Scartato: sovrascrivere senza avvisare.
- **Il drafter gira in `%TEMP%\ark\drafter`.** Scartato `%TEMP%`, che è condiviso con altri programmi.
- **Prova manuale fatta dopo il giro di correzioni finale**, così verifica il codice che verrà integrato.
- **Integrazione:** PR su `main` come per la Fase 0 (scelta dell'utente). Scartati il merge locale e il lasciare il branch fermo.

## File toccati

Tutti sul branch `phase1-engines-catalog`.

- **`src/shared/`:**
  - `agent-file.ts`: formato del file agente, parse, serializzazione, `validateAgent`, `agentId`;
  - `agent-problems.ts`, `chat-log.ts` (reducer della chat), `agent-draft.ts` (`DRAFTER`, `extractAgentFile`);
  - `types.ts`: `ChatEvent`, `CatalogList`, `EngineInfo` e le aggiunte ad `ArkApi`.
- **`src/main/services/`:**
  - `skills.ts`: indice delle skill, cartella privata, `pluginInstalls` esportato;
  - `catalog.ts`: catalogo, agenti di partenza, import;
  - `files.ts`: `writeAtomic`, spostato da `statusline.ts`;
  - `agent-runner.ts`: `startAgent`, `oneShot`, `stopAll`, flag `stopping`;
  - `exec.ts`: `run()` non lancia più eccezioni su un `.exe` non valido.
- **`src/main/services/engines/`:**
  - `isolation.ts`: `cleanEnv`, `claudeEnv`, `claudeArgs`, `codexArgs`, `CODEX_BASE_ARGS`, i controlli;
  - `models.ts`: tier → modello, `resolveRun`;
  - `session.ts`: `nodeSpawn` con kill dell'albero di processi, `spawnCommand`, `jsonLines`;
  - `claude-session.ts`, `codex-session.ts`, `app-server-client.ts`, `project-rules.ts`;
  - `config.ts`: `engines.json` e `mergeEngines`.
- **`src/main/services/adapters/codex-appserver.ts`:** ora usa `AppServerClient` (stessa firma).
- **`src/main/ipc/index.ts`, `src/preload/index.ts`, `src/main/index.ts`:** canali catalog, skills, engines e chat; collegamenti; pulizia delle sessioni all'avvio; `before-quit`.
- **`src/renderer/`:**
  - `pages/Agents.tsx`, `pages/AgentForm.tsx`, `pages/Chat.tsx`;
  - `hooks/useCatalog.ts`, `hooks/useChat.ts`;
  - `errors.ts` (`readable`);
  - modifiche a `App.tsx`, `agents.ts`, `components/Page.tsx`, `pages/Usage.tsx` e `pages/StatuslineConnect.tsx`.
- **Test:**
  - `tests/shared/*`, `tests/main/*` (inclusi `session-kill.test.ts`, `agent-runner.test.ts`, `codex-session.test.ts`);
  - `tests/helpers/fake-child.ts`, `tests/helpers/fake-app-server.ts`;
  - `tests/fixtures/claude-stream.jsonl`, `tests/fixtures/skills/ark-probe-a|b`;
  - `tests/live/engines.live.test.ts`, `vitest.live.config.mts`.
- **Configurazione e documentazione:**
  - `vitest.config.mts`: esclude `tests/live/**`;
  - `package.json`: `yaml` e lo script `test:live`;
  - `README.md`: sezione `Agents`.
- **Fuori dal repo:**
  - `.tmp/e2e/` (script della prova end-to-end, ignorato da git);
  - in `%APPDATA%\ark\agents` i 7 agenti di partenza;
  - in `%TEMP%` due cartelle rimaste, `ark-live-8oFk4t` e `ark-live-4d9QY7`, che si possono cancellare.

## Dove vogliamo andare

1. **Fai la prova della chat dalla UI** (lo fa l'utente, servono due minuti): `npm run dev` → Agents → Planner → Chat → Choose folder → Start chat → due messaggi. Controlla il tag del modello `sonnet` e la riga `in …  cached …  out …`. Poi chiudi Ark con la chat aperta e verifica con `Get-Process claude,codex` che non resti niente.
2. **Apri la PR** di `phase1-engines-catalog` su `main`, come per la Fase 0: `git push -u origin phase1-engines-catalog`, poi `gh pr create --body-file <file>`. Nel corpo metti il riassunto, le decisioni prese e i punti rimandati qui sotto.
3. **Poi il passo 2 della Fase 1** (thread col team): nuovo piano dallo spec §8 e §12, con `superpowers:writing-plans`. Includi questi punti rimandati dal passo 1:
   - `app.requestSingleInstanceLock()`: una seconda istanza cancellerebbe le cartelle di sessione della prima;
   - il drafter vede ancora un `CLAUDE.md` nelle cartelle sopra (`%TEMP%`);
   - una ricarica del renderer (Ctrl+R) lascia le sessioni vive fino alla chiusura dell'app;
   - Codex non ricontrolla le skill a ogni turno;
   - le skill vietate su Claude si confrontano solo per cartella, non per nome nel frontmatter;
   - codice duplicato: `agentProblems` contro `resolveRun`, `isObject` contro `obj`, la regex dell'id;
   - lacune nella quotatura di `spawnCommand` per un `codex.cmd` (falliscono chiuse);
   - strumenti di rete e di pianificazione ancora attivi negli agenti read-only (`WebFetch`, `Cron*`, `Workflow`…), da rivedere con i permessi dello step 3.

## Da sapere prima di toccare qualcosa

- **Valgono ancora le regole dell'handoff precedente:**
  - mai scrivere in `~/.claude`, `~/.codex` o `~/.agents`, e mai leggere file di credenziali;
  - commit sempre con `git commit -F <file>` e `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - per la PR, `gh pr create --body-file`;
  - `npm test` non chiama mai un modello; i test dal vivo si lanciano solo con `npm run test:live`.
- **`claudeArgs` è diverso dal piano** (`--setting-sources project` e `PowerShell` tra i tool vietati). Il test `claudeArgs is exact` lo fissa. Non ripristinare `project,local`.
- **`CODEX_BASE_ARGS` ora vive in `isolation.ts`** (con `--disable memories`) e `codex-session.ts` lo ri-esporta.
- **Il terminale gira dentro Orca e dentro Claude Code.** Per prove manuali dei motori usa `cleanEnv`/`claudeEnv`, o togli le variabili `CLAUDE_CODE_*`.
- **`orca computer` sull'app Electron:**
  - l'albero di accessibilità della pagina compare solo dopo che si è aperto un dialog;
  - i clic a coordinate sono inaffidabili;
  - Tab e Invio con `--restore-window` funzionano.
- **Usage mostra molte sessioni "codex-project":** sono le sessioni dei test dal vivo, non un bug.
- **Su Windows, `rmSync` subito dopo il kill del motore può dare EPERM.** Per questo la pulizia è best-effort.
- **Se `test:live` fallisce con una violazione d'isolamento, fermati:** non allentare mai i controlli.
