---
type: handoff
date: 2026-11-12
status: pronto per review
seq: 2
prev: docs/handoff/2026-11-12-head-of-staff.md
tags: [ark, head-of-staff, agenti, team-pronti, skill-custom, review, pr]
---

# Handoff 2 - Head of Staff: piano 4 chiuso, review fatta, PR aperta

Branch `feat/head-of-staff`, pushato, **PR #6** verso `main`: https://github.com/yintong-zhou/ark/pull/6. Ultimo commit: `38829b0`.

## Obiettivo

Invariato rispetto al primo handoff: Ark non ha agenti di serie. Il catalogo parte vuoto, l'utente crea i suoi agenti o aggiunge un team pronto (IT Services). Resta un solo orchestratore, il **Head of Staff**, che giudica la difficoltà e assegna agenti e modelli dell'utente; se manca un ruolo lo dice. Il thread (messaggi, card, piano, build in worktree, controlli, review, permessi) non cambia. Design e piani in `docs/superpowers/`.

## A che punto siamo

Tutti e quattro i piani sono implementati e committati; la review indipendente è fatta; la PR è aperta.

Commit dopo `f797a38`:
- `a7cab51` piano 4 task 2: `forbidden` in `agent-runner.ts` viene da `deps.personalSkills()`, così una skill importata con lo stesso nome non nasconde quella personale di Claude. `index.ts` estrae `skillRoots`.
- `cc568e7` piano 4 task 3: canali `skills:import|replace|remove`, preload, `ArkApi.skills`, bottone Import skill con Replace e Remove nel campo Skills (`AgentForm` e `HeadForm`), `reloadSkills` in `useCatalog`, documenti.
- `cedfc4f` `skills.ts`: `SAFE_SKILL` rifiuta nomi riservati Windows e punto/trattino finale; l'indice Ark prende solo cartelle vere con nome valido (via `arkSkillDir`), quindi niente junction né `.import-*`.
- `7b2920c` `rules.ts`: in un thread easy il primo builder fa sempre da planner.
- `38829b0` `conductor.ts` `send()`: un thread in build con ruoli non più validi (`buildProblem`) passa da `runLegacy`, il Head riassegna i ruoli. Prima andava in `error` a ogni messaggio.

Verificato su `38829b0`: `npm run typecheck`, `npm run lint`, `npm test` (61 file, 956 test), `npm run build` passano.

Review: un reviewer di correttezza e un auditor di sicurezza (agenti, sola lettura, senza eseguire nulla). Nessun bug critico; invarianti confermati: solo i builder scrivono, la card di rinuncia alla review c'è in ogni modalità (Full incluso), un reviewer non può essere builder, isolamento e upload avatar reggono.

Mai fatto: **prove manuali nell'app** e `npm run test:live` (consumano motori veri e abbonamento).

## Cosa abbiamo provato che NON ha funzionato

- **Far passare il Head dei thread vecchi per `t.team` invece del catalogo** (suggerimento dell'auditor, `conductor.ts` riga ~762, `runLegacy`). Il test "an old mid-build thread gets its roles from the Head of Staff" lo richiede: un thread vecchio ha il team `[project-manager]` e nessun builder, quindi il Head deve poter scegliere dal catalogo. Annullato. Resta una decisione aperta (vedi sotto).
- **Rilassare il controllo di generazione** nella card di rinuncia alla review (`startDeveloper`, `entryGen`): se l'utente manda un messaggio mentre la card è aperta e poi preme Allow, la build non parte con un errore fuorviante. Non toccato perché un refresh del `entryGen` potrebbe far partire una build dopo uno Stop.
- **Heredoc con node/sed dentro la shell Bash** con virgolette e backslash: falliscono o mangiano i backslash (`%APPDATA%\ark` diventava `%APPDATA%arkskills`). Usare lo strumento Write per gli script e Edit per le stringhe con backslash.
- **`npx.cmd`/`npm.cmd` hanno smesso di funzionare a metà sessione** nella shell Bash ("'C:\Program' is not recognized"), dopo un `cp`. Alternativa che funziona: `node node_modules/vitest/vitest.mjs run <file> -t "<nome>"`.

## Problemi incontrati e come li abbiamo risolti

- Due test vecchi in `agent-runner.test.ts` passavano `claude-user` solo da `skills`: ora `setup()` ricava `personalSkills` di default dal filtro `source === 'claude-user'` se `personal` non è dato. Anche i due test live (`build`, `thread`) hanno la nuova dipendenza.
- Il test Windows su junction (`symlinkSync(..., 'junction')`) non richiede privilegi.

## Decisioni prese

- **Percorso legacy, catalogo intero**: il Head può aggiungere al team un builder preso dal catalogo senza card. Mantenuto perché serve ai thread vecchi. Alternativa scartata per ora: una card quando il Head aggiunge qualcuno. **L'utente non ha ancora deciso.**
- **Review in due passate di agenti**, non `/code-review`, scelta mia; l'utente ha dato libertà di agire.
- **Push e PR fatti** dopo il "si" dell'utente alla proposta "poi apro la PR". Descrizione della PR in `.tmp/pr-body.md` (ignorato da git), chiusa con la riga di attribuzione.
- Gli handoff `docs/handoff/*.md` sono **non tracciati** (il primo lo era già); non li ho committati perché l'utente non l'ha chiesto.

## File toccati (questa sessione)

- `src/main/services/agent-runner.ts`: `RunnerDeps.personalSkills`, `forbidden` da lì.
- `src/main/index.ts`: `skillRoots` estratto, `personalSkills` passato al runner.
- `src/main/services/skills.ts`: `SAFE_SKILL` più stretto, indice Ark filtrato con `arkSkillDir`.
- `src/main/ipc/index.ts`: canali `skills:import|replace|remove` (`keptSkill` tenuto in main).
- `src/preload/index.ts`, `src/shared/types.ts`: API `skills`.
- `src/renderer/components/AgentFields.tsx` (`SkillsField`), `hooks/useCatalog.ts`, `pages/AgentForm.tsx`, `pages/HeadForm.tsx`.
- `src/main/services/threads/rules.ts` (planner easy), `conductor.ts` (`send()` e `buildProblem`).
- Test: `agent-runner.test.ts`, `skills.test.ts`, `conductor.test.ts`, `tests/live/build.live.test.ts`, `tests/live/thread.live.test.ts`.
- Documenti: `CLAUDE.md`, `AGENTS.md` (`skills` tra i dati utente), `README.md` (paragrafo Import skill).

## Dove vogliamo andare

1. **Chiedere all'utente di fare le prove manuali** (o di autorizzarle): `npm run dev` interroga il Codex reale per l'elenco modelli. Elenco in `docs/handoff/2026-11-12-head-of-staff.md`, sezione "Dove vogliamo andare" punto 4, più quelle del piano 4 (import, doppio import con Replace, cartella senza `SKILL.md`, originale cancellato, rimozione, schermata Head of Staff).
2. **Decidere con l'utente** il punto del percorso legacy (catalogo intero oppure card) e se `gpt-6.1-terra` era il modello Codex giusto (mai confermato).
3. **Punti minori aperti**, tutti dalla review, nessuno bloccante: il Head non ha un blocco Ark per rispondere in prosa in un thread di sola analisi (`protocol.ts`/`rules.ts`); l'upgrade dei thread vecchi non sposta `cursors`/`handoffs`/`assignments` da `LEGACY_MANAGER` a `MANAGER` e i vecchi messaggi `project-manager` compaiono come di un altro autore; `Update team` sovrascrive anche gli agenti personalizzati o cancellati; il Head parte a `tier: 'light'`; `catalog:save` scrive o cancella l'avatar prima della validazione completa; le facce di default non sono salvate e cambiano se si aggiungono o tolgono agenti; la card di rinuncia (sopra); `waived` non viene mai tolto.
4. **Chiudere la PR #6** quando l'utente è soddisfatto (`superpowers:finishing-a-development-branch`). Non fare merge né force-push senza richiesta.

## Da sapere prima di toccare qualcosa

- Comandi di verifica: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. **Mai `npm run test:live`** senza chiedere.
- Messaggi di commit: scrivere il file senza BOM e usare `git commit -F <file>` (c'è già in memoria utente). Usato `.tmp/commit-msg.txt`. Ogni commit termina con `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; le PR con la riga `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- `git status` mostra avvisi "LF will be replaced by CRLF": normali. Dopo un `git diff` una modifica "fantasma" a `conductor.ts` può apparire come solo fine riga: ignorarla.
- Il test rosso del primo handoff non esiste più. Il test "a build whose reviewer left the catalog is not stuck" è voluto: fallisce senza la modifica in `send()`.
- Regole del progetto sempre valide: trattino al posto del trattino lungo, UI in inglese, `engines/isolation.ts` non si indebolisce, Full access unico bypass.
- `.tmp/` è ignorato da git (contiene `pr-body.md`, `commit-msg.txt`, script di appoggio, `hos-progress.md` di Codex).
