---
type: handoff
date: 2026-11-05
status: pronto per implementazione
seq: 2
prev: docs/handoff/2026-11-05-ark-phase0.md
tags: [ark, electron, phase1, agent-teams, isolation, claude-code, codex]
---

# Handoff - Ark Fase 1, passo 1 (motori e catalogo)

## Obiettivo

Ark Fase 1: al posto di un solo Opus che fa tutto, un piccolo team di agenti lavora in un thread. Ogni agente ha il suo ruolo, il suo modello e **solo le sue skill**. Il motivo principale è il **costo**: i modelli economici fanno il lavoro facile, Opus solo quello difficile. La qualità deve restare quella di oggi.

Il passo 1 serve a scegliere un agente dal catalogo e chattarci su Claude Code o Codex, con l'isolamento verificato su entrambi i motori.

## A che punto siamo

- **Branch `phase1-engines-catalog`**, che parte da `main` (`2eee786`, cioè la PR #2 mergiata). Contiene:
  - `2c75b84`: il design della Fase 1, approvato dall'utente;
  - un commit con il piano del passo 1 e questo handoff.
- **Design approvato:** `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md`. È l'autorità; le scelte del designer sono segnate **[call]**.
- **Piano:** `docs/superpowers/plans/2026-11-05-phase1-step1-engines-catalog.md`, 12 task. L'utente ha scelto di eseguirlo **subagent-driven**.
  - L'implementazione **non è iniziata**: zero codice della Fase 1.
- **Fase 0:**
  - completa e mergiata (PR #1 e #2);
  - prova dal vivo di Connect/Disconnect passata: `settings.json` è tornato identico byte per byte;
  - runner Electron (`ELECTRON_RUN_AS_NODE`) verificato.
- Su `main`: 52/52 test, typecheck, lint e build verdi.

## Cosa abbiamo provato che NON ha funzionato

- **`claude --safe-mode` per isolare.** Spegne CLAUDE.md, plugin, hook e MCP, ma **spegne anche le skill caricate con `--plugin-dir`**. → Usare `--setting-sources project,local --strict-mcp-config --plugin-dir <privato>`.
- **`claude --bare`.** Non mantiene il login dell'abbonamento. → Scartato.
- **Lanciare `claude` con l'ambiente ereditato.** Orca inietta `CLAUDE_CODE_PLUGIN_DIRS`, cioè un plugin con hook, più altre variabili `CLAUDE_CODE_*` della sessione madre. → Togliere sempre le variabili `STRIPPED_ENV` (Task 3) prima di avviare i motori.
- **Codex `--enable skip_host_skill_discovery`.** Non toglie le skill di `~/.agents/skills`. → Spegnerle per path con `-c skills.config=[{path=…,enabled=false}]`.
- **Codex `-c mcp_servers={}`.** Non svuota la tabella, la unisce a quella esistente. → `-c mcp_servers.<nome>.enabled=false` per ogni server.
- **Codex `skills/config/write`.** Scrive in `~/.codex/config.toml` in modo permanente, cosa vietata. → Mai usarlo.
- **Seed dei revisori con `code-review` / `security-review`.** Sono skill integrate in Claude Code, senza file, quindi non si possono copiare su Codex. → `agent-skills:code-review-and-quality` e `agent-skills:security-and-hardening`.
- **`git commit -m @'…'@` in PowerShell 5.1 con virgolette nel testo.** Il messaggio si spezza, il commit fallisce senza errori evidenti e le modifiche finiscono nel commit dopo. Correggerlo richiede un force push, che la modalità auto nega. → **Sempre `git commit -F <file>`**, e `gh pr create --body-file`.

## Problemi incontrati e come li abbiamo risolti

- **Al primo avvio la UI mostrava "not installed" per un attimo.**
  - Causa: `usage:get` rispondeva prima del rilevamento degli agenti.
  - Fix: `UsageService.ready()`.
- **Un adapter in errore fermava tutti gli altri.**
  - Causa: `Promise.all` senza protezione per singolo adapter.
  - Fix: `each()` con `allSettled` in `usage.ts`.
- **I file `tsconfig.*.tsbuildinfo` erano tracciati da git**, e il typecheck sporcava il working tree.
  - Fix: aggiunti a `.gitignore` e tolti dal repo.

## Decisioni prese

- **Team per thread.** Un project manager guida; i ruoli si pescano dal catalogo; ogni thread parte da una fase che decide il team. Gli agenti ti taggano (`@tu`), e tu rispondi o reagisci. Scelta dell'utente.
- **Revisione e sicurezza girano entrambe su Codex** (scelta dell'utente), con tier standard.
- **Sviluppo a fasi:** sviluppo → verifica codice → sicurezza → fase successiva; dopo 2 giri senza accordo l'agente chiama l'utente. Il limite di 2 giri è un [call].
- **Isolamento come regola fissa:**
  - niente skill, plugin, MCP, hook o `CLAUDE.md` personali, a meno che l'agente non li abbia;
  - il `CLAUDE.md` / `AGENTS.md` del progetto invece resta;
  - se l'isolamento fallisce, l'agente non parte.
- **Libreria di skill unica.** Ark copia le skill dell'agente in una cartella privata per ogni sessione. È anche il meccanismo dell'isolamento.
- **Sessioni nuove invece di sessioni infinite:**
  - lo sviluppatore riparte a ogni fase;
  - i revisori a ogni revisione;
  - gli altri agenti fanno un passaggio di consegne al 50% di contesto.
- **Costo:** si mostrano i token esatti per agente e per modello. Le finestre di 5 ore e settimanale si mostrano come movimento dell'account, con la nota che includono anche le altre sessioni.
- **Auto** è una tabella di regole fissa, scelta al posto di un LLM che decide. Al 90% di un limite di Claude, il lavoro leggero e quello medio passano a Codex.
- **Rimandati a dopo la Fase 1:** kanban, memoria condivisa, OpenCode, notifiche di Windows, merge del branch.
- **Ordine di costruzione della Fase 1:**
  1. motori e catalogo (questo piano);
  2. thread col team;
  3. sviluppo a fasi;
  4. Auto e costi.
  Ogni passo ha il suo piano.
- **Esecuzione del passo 1: subagent-driven**, scelta dell'utente al posto di Native, nonostante Native fosse consigliato per il costo.

## File toccati

- `docs/superpowers/specs/2026-11-05-phase1-agent-teams-design.md` - design della Fase 1 (nuovo, committato).
- `docs/superpowers/plans/2026-11-05-phase1-step1-engines-catalog.md` - piano del passo 1 (nuovo).
- `docs/handoff/2026-11-05-ark-phase1-step1.md` - questo file.
- Già su `main`, con la PR #2:
  - `src/main/services/usage.ts`: `each()` e `ready()`;
  - `src/main/ipc/index.ts`: `usage:get` → `ready()`;
  - `tests/main/usage.test.ts`: 2 test nuovi;
  - `.gitignore`: `*.tsbuildinfo`.
- Fuori dal repo:
  - `.tmp/` contiene gli script di prova (`codex-isolation.mts`, `chat-probe.mts`, `codex-skills.mts`, `probe/`). Sono ignorati da git e utili come riferimento dei protocolli.
  - `.superpowers/brainstorm/30747-1793885178/content/` contiene i mockup della Fase 1 (`thread-team.html`, `catalog-and-team.html`, `build-phases.html`).

## Dove vogliamo andare

1. **Esegui il piano** `docs/superpowers/plans/2026-11-05-phase1-step1-engines-catalog.md` con la skill `superpowers:subagent-driven-development`, sul branch `phase1-engines-catalog`, task per task (1 → 12).
2. **Al Task 6 (live gate)**, se l'isolamento fallisce su un motore, **fermati** e riferisci le violazioni all'utente, senza passare al Task 7.
3. **A fine piano** fai la revisione dell'intero branch e la verifica del Task 12 (typecheck, lint, test, build, `npm run test:live`, prova manuale in dev). Poi chiedi all'utente come integrare il branch (PR come per la Fase 0).
4. **Poi** il passo 2 della Fase 1 (thread col team): nuovo piano dal design §8 e §12.

## Da sapere prima di toccare qualcosa

- **Non scrivere mai** in `~/.claude`, `~/.codex` o `~/.agents`, e **non leggere** `auth.json` o `.credentials.json`. Connect/Disconnect della Fase 0 sono l'unica eccezione, e solo su click esplicito.
- **Commit e PR:** messaggio in un file, poi `git commit -F <file>`; un commit per comando, controllando il risultato prima del push. Ogni messaggio finisce con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Test dal vivo** solo con `npm run test:live` (il Task 6 crea il comando): usano l'abbonamento, ma con il tier leggero e prompt di una riga. `npm test` non deve mai chiamare un modello.
- **Questo terminale gira dentro Orca e dentro una sessione Claude Code.** Le variabili `CLAUDE_CODE_*` e `ORCA_*` sono nell'ambiente: per qualunque prova manuale dei motori, toglile (`env -u …`) o usa `cleanEnv`.
- **Bash tool:** riduce `\\` a `\` e si rompe con gli apostrofi negli heredoc. Per file con path Windows o regex usa lo strumento Write. Per script TS usa `.mts` in `.tmp/`, eseguiti con `npx tsx`.
- **Schema dell'app-server di Codex:** si rigenera con `codex app-server generate-ts --out .tmp/codex-schema`.
- **Comandi pronti:**
  - **Claude isolato:** `claude -p --setting-sources project,local --strict-mcp-config --plugin-dir <dir> --input-format stream-json --output-format stream-json --verbose --model haiku`.
  - **Codex isolato:** `codex app-server --disable plugins --disable apps --disable hooks -c skills.config=[…] -c mcp_servers.<n>.enabled=false`, poi `skills/extraRoots/set`.
- I warning CRLF di git sono innocui.
- Le regole di `AGENTv2.md` valgono:
  - `directives/` non si crea né si modifica senza chiedere;
  - prima di dire "fatto", lanciare typecheck, lint, test e build, più la prova in dev mode per UI e main process.
