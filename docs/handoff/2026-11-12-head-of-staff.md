---
type: handoff
date: 2026-11-12
status: in corso
seq: 1
prev: null
tags: [ark, head-of-staff, agenti, team-pronti, skill-custom, codex]
---

# Handoff - Head of Staff, agenti dell'utente, team pronti, skill custom

Branch `feat/head-of-staff` (4 commit sopra `main`, mai pushato, nessuna PR). Ultimo commit: `f797a38`.

## Obiettivo

Ark non deve più avere agenti di serie. All'installazione il catalogo è vuoto: l'utente crea i suoi agenti da zero oppure
aggiunge un team pronto (oggi solo IT Services). Resta incluso in Ark un solo orchestratore, il **Head of Staff**, che legge
la richiesta, ne giudica la difficoltà e mette sul lavoro gli agenti e i modelli giusti. Se manca un ruolo (chi pianifica,
chi costruisce, chi fa la review) lo dice all'utente e gli dice quale agente creare. Il thread (messaggi, `@`, card, piano,
build in worktree, controlli, review, modalità di permessi) non deve cambiare.

Il perché: oggi un project manager, un developer e due reviewer "di serie" fanno il lavoro al posto degli agenti
dell'utente. L'utente vuole che il lavoro lo facciano i suoi agenti, ognuno riconoscibile (immagine, alias, ruolo,
username con la `@`, modello, skill).

Documenti di riferimento, tutti committati:
- design approvato dall'utente il 2026-11-12: `docs/superpowers/specs/2026-11-12-head-of-staff-design.md`
- quattro piani: `docs/superpowers/plans/2026-11-12-hos-1-agent-profile.md`, `-2-head-of-staff.md`, `-3-ready-teams.md`, `-4-skill-import.md`

## A che punto siamo

Fatto e committato in `f797a38` (un solo commit al posto di uno per task, vedi sotto), tutto scritto da Codex:
- **Piano 1** (scheda dell'agente): task 1-6 fatti. Alias, ruolo, avatar, lock nel file dell'agente; 24 facce + una per il Head of Staff; immagini caricate (`avatars.ts`); elenco modelli Codex; nuovo form.
- **Piano 2** (Head of Staff): task 1-9 fatti, più una correzione extra alla migrazione dei thread vecchi. Livelli al posto del flag `hard`, ruoli e difficoltà nella proposta del team, build con builder per fase, card "build senza review", thread vecchi, interfaccia, documenti.
- **Piano 3** (team pronti): task 1-3 fatti. IT Services con sviluppatori che costruiscono, `Add team` / `Update team`.
- **Piano 4** (skill custom): **task 1 fatto** in `src/main/services/skills.ts` (`checkSkillFolder`, `importSkill`, `arkSkillDir`, `personalSkills`, source `'ark'` indicizzata per prima, `ark: join(userData, 'skills')` nelle roots in `src/main/index.ts`).

Verificato da me fuori dalla sandbox di Codex, su `f797a38`: `npm run typecheck`, `npm run lint`, `npm test` (61 file, 953 test) e `npm run build` passano.

A metà (unico file modificato e non committato): `tests/main/agent-runner.test.ts`. Ci ho aggiunto l'opzione `personal` in `setup()`, la dep `personalSkills` e il test **rosso** "a personal skill hidden by an imported one of the same name is still forbidden". Fallisce come previsto: `forbidden` non contiene `handoff`, perché `src/main/services/agent-runner.ts` non è stato toccato.

Non iniziato: piano 4 task 2 (implementazione), task 3 (canali IPC, form, documenti).

Mai fatte, in nessuna parte: le **prove manuali nell'app** (elenco sotto in "Da sapere") e una **review indipendente** delle quasi 2000 righe scritte da Codex.

## Cosa abbiamo provato che NON ha funzionato

- **Far fare i commit a Codex.** La sua sandbox non può creare `.git/index.lock`: `git add` fallisce. Soluzione: Codex lascia i file non committati e il commit lo faccio io fuori dalla sandbox. Per questo c'è un commit unico `f797a38` invece di uno per task, contro quanto dicono i piani.
- **Codex ha finito i crediti.** Dopo 59 minuti la corsa unica si è fermata con `Your workspace is out of credits. Add credits to continue.`, a metà del piano 4 task 1. Per proseguire con Codex servono crediti; altrimenti si continua con Claude.
- **`/codex:transfer questa sessione`.** Fallito: `Codex reported that the Claude import completed, but did not record an imported thread`. Non ritentare così.
- **Un test del piano 1 task 2 non compilava** (`assignFaces<T>` ritornava `T`, il test leggeva `a.avatar` da `{ id: string }`, TS2339). Corretto tipizzando l'input del test, interfaccia invariata.
- **Python non c'è su questa macchina** (lo shim rimanda al Microsoft Store). Gli script `python -` in heredoc falliscono: usare Edit o heredoc bash.
- **Un "difetto" che non esisteva.** Avevo scritto nel design che `catalog:save` passava l'id da `agentId()` trasformando `_` in `-`. Avevo letto male: l'handler valida soltanto. Tolto dal design (commit `f56bc28`). Non rimetterlo.

## Problemi incontrati e come li abbiamo risolti

- **3 test falliscono solo nella sandbox di Codex**: un test Git (warning di permessi al posto del messaggio atteso), `session-kill` e il test di abort (timeout con errori di pulizia della cartella temporanea). Fuori dalla sandbox passano tutti. Se Codex riferisce "3 falliti", sono questi.
- **PowerShell blocca gli script npm/npx** per Codex: usare `npm.cmd` e `npx.cmd`.
- **Messaggi di commit**: in PowerShell 5.1 gli here-string con virgolette passati a `-m` si spezzano. Usare `git commit -F <file>` con il file scritto senza BOM (c'è già in memoria utente). Il file che ho usato è `C:\Users\zhouy\AppData\Local\Temp\claude\17b896210a039d22\700286db-c672-4f13-a0d5-f86445ed0ace\scratchpad\commit-msg.txt`; va riscritto per ogni commit.
- **Modello "terra".** L'utente ha scritto "tera effort high". Sul PC esistono `gpt-5.6-terra` e `gpt-6.1-terra`; ho usato `gpt-6.1-terra` (il più recente). L'utente non ha confermato quale volesse.

## Decisioni prese

Dall'utente (nel design sono marcate `(user)`):
- Nessun agente di serie. Developer, code reviewer, security reviewer e project manager **non devono esistere più**; li crea l'utente o li prende da un team pronto. Scartato: ricrearli una volta nel catalogo all'aggiornamento.
- L'orchestratore si chiama **Head of Staff**, è dentro Ark, non è nel catalogo, non si cancella; le sue istruzioni non si modificano, ma si assegnano skill e modello.
- Richiesta facile: niente manager, si va dritti ai builder. Richiesta difficile: manager, poi sviluppatori, poi un piano diviso in fasi scritto con modello forte (Opus). Esecuzione con modello medio (Sonnet, o Luna/Terra su Codex).
- Se un agente ha un modello scelto dall'utente, decide Head of Staff **salvo lock** sul modello.
- Immagini: stile A "personaggi" (facce semplici disegnate), ogni agente ne ha una di default e diversa, più Upload dal PC.
- Team pronti: solo IT Services. Scartati Marketing e Grafica ("era solo un esempio").
- Skill custom: form "Importa skill" nella configurazione degli agenti.
- Per ora l'esecuzione dei piani passa a Codex (poi finiti i crediti Codex: da decidere come proseguire).

Prese da me (marcate `(call)` nel design, l'utente le ha approvate insieme al documento):
- Ruoli proposti subito da Head of Staff ma modificabili fino a Start, senza seconda card di approvazione; la card del piano mostra chi costruisce ogni fase.
- Thread senza modifiche ai file (domande, analisi): nessun builder né reviewer richiesto.
- Richiesta facile: mini-piano di una fase scritto dal builder (mantiene worktree, controlli, review).
- Review mancante: card Allow/Deny prima della build, **in ogni modalità, anche Full access**. Deny lascia il piano in attesa. Un reviewer non può essere builder dello stesso thread.
- Catalogo vuoto: il thread non viene creato e non parte nessun motore.
- Aggiornamento: agenti esistenti restano; thread vecchi continuano sotto Head of Staff; un thread a metà build si ferma con una nota e Head of Staff riassegna i ruoli al messaggio successivo.
- Team IT Services già aggiunto con la vecchia versione: bottone "Update team" che riscrive i 14 profili dopo conferma.
- Modello: il campo Tier esce dal form; un modello esatto già salvato conta come bloccato; username immutabile dopo la creazione; `head-of-staff` riservato.
- Skill importate in `%APPDATA%\ark\skills`, vincono su una installata con lo stesso nome, max 200 file e 5 MB, nessun link seguito. **L'isolamento non si allenta**: la skill personale di Claude con lo stesso nome resta vietata all'agente (è il task 2 del piano 4).
- Immagini caricate: PNG, JPEG, WebP fino a 512 KB.

Scostamenti di Codex dai piani, tutti registrati in `.tmp/hos-progress.md` (cartella ignorata da git, può servire riaprirla): vale la pena rileggere quelli sul piano 2 (task 3, 4, 5, 7, 8) perché toccano chi può scrivere file e quando si salta una review. Il più rilevante: thread con Head già primo nel team sono trattati come nuovi anche senza `roles`.

## File toccati

72 file in `f797a38` (`git show --stat f797a38` per l'elenco). Per area:
- `src/shared/`: `agent-file.ts` (alias, role, avatar, lock, id riservati), `avatars.ts` (facce e assegnazione), `roles.ts` (controllo proposta e ruoli), `plan.ts` (`parsePhases` con builder per fase), `thread-upgrade.ts` (thread vecchi), `thread.ts` (`MANAGER = 'head-of-staff'`, `LEGACY_MANAGER`, ruoli, difficoltà), `agent-problems.ts` (`ownLevel`, `atLevel`, `chooseThreadEngine` per mestiere), `types.ts`, `permissions.ts`, `agent-draft.ts`.
- `src/main/services/`: `head-of-staff.ts` (nuovo), `avatars.ts` (nuovo), `teams.ts` (nuovo), `catalog.ts`, `it-services.ts`, `skills.ts`, `settings.ts`, `engines/models.ts`; **cancellato** `thread-agents.ts`.
- `src/main/services/threads/`: `conductor.ts`, `rules.ts`, `build-rules.ts`, `protocol.ts` (nuovi protocolli `HEAD_PROTOCOL`, `BUILDER_PROTOCOL`), `store.ts`.
- `src/main/ipc/index.ts`, `src/main/index.ts`, `src/preload/index.ts`.
- `src/renderer/`: `AgentFields.tsx`, `faces.tsx`, `HeadForm.tsx` (nuovi), `AgentForm.tsx`, `Agents.tsx`, `Avatar.tsx`, `Cards.tsx`, `TeamPanel.tsx`, `ThreadView.tsx`, `Threads.tsx`, `Chat.tsx`, `Composer.tsx`, `Sidebars.tsx`, `useCatalog.ts`, `App.tsx`, `agents.ts`.
- Test: nuovi `avatars`, `head-of-staff`, `it-services`, `roles`, `thread-upgrade`, `faces`, `cards`; molto estesi `conductor.test.ts`, `build-rules`, `thread-rules`, `thread-protocol`, `catalog`, `skills`; `tests/live/*` ritoccati solo perché compilino.
- Documenti: `CLAUDE.md`, `AGENTS.md` (allineato a CLAUDE.md per regola del repo), `README.md`, `PROJECT.md`.
- Non committato: `tests/main/agent-runner.test.ts` (test rosso, vedi sopra).

## Dove vogliamo andare

1. **Piano 4 task 2.** In `src/main/services/agent-runner.ts` aggiungere a `RunnerDeps` `personalSkills: () => SkillEntry[]` e costruire `forbidden` da `deps.personalSkills()` (di ognuna `folder` e `name`) più i comandi del progetto, non più dall'indice filtrato per `source === 'claude-user'`. In `src/main/index.ts` passare `personalSkills: () => personalSkills(roots)`: oggi le roots sono scritte inline dentro `skills`, vanno estratte in una costante. Far passare il test rosso, poi `npm run typecheck`, `npm run lint`, `npm test`; commit.
2. **Piano 4 task 3.** Canali IPC `skills:import`, `skills:replace`, `skills:remove` (cestino), metodi in `src/preload/index.ts` e `ArkApi.skills`, bottone "Import skill" nel campo Skills di `AgentForm` e `HeadForm`, riga sorgente `Ark`, `Remove`, aggiornare `CLAUDE.md`/`AGENTS.md` (`skills` tra i dati utente) e `README.md`. Dettagli nel piano.
3. **Review indipendente dell'intero branch** prima di qualsiasi PR (`/code-review`, e una passata di sicurezza): nessuno ha riletto le ~2000 righe di Codex. Punti da guardare per primi: `conductor.ts` (chi può scrivere, card di rinuncia alla review, Full access resta l'unico bypass), i filtri di isolamento, l'upgrade dei thread vecchi.
4. **Prove manuali nell'app** (mai fatte). Vanno chieste all'utente prima di toccare motori veri, perché consumano il suo abbonamento. Elenco, dal log di Codex:
   - piano 1: faccia di default distinta; username suggerito e rifiuto delle maiuscole; elenco modelli e lock; anteprima PNG nel form, nell'elenco e nel pannello team; rifiuto di un `.txt` rinominato `.png`; file di un agente vecchio salvato senza modifiche;
   - piano 2: catalogo vuoto (riga Head of Staff e rifiuto); richiesta facile con mini-piano; card di rinuncia alla review (Deny e Allow) e build nel worktree; richiesta difficile senza manager; thread vecchio con storia e prosecuzione;
   - piano 3: stato vuoto e Add; modifica, cancellazione e conferma di Update; build con IT Services; vecchio team read-only senza builder;
   - piano 4: import, doppio import con Replace, cartella senza `SKILL.md`, originale cancellato, rimozione.
5. Poi chiudere il branch (`superpowers:finishing-a-development-branch`): PR verso `main` con la descrizione che termina con la riga di attribuzione richiesta dal contesto, e `git push` solo su richiesta dell'utente.
6. Da chiedere all'utente: come proseguire senza Codex (crediti finiti), se `gpt-6.1-terra` era il modello giusto, e se la review dell'intero branch si fa con un agente o a mano.

## Da sapere prima di toccare qualcosa

- Comandi di verifica: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. **Mai `npm run test:live`** (consuma l'abbonamento), né avviare sessioni di motori veri senza chiedere.
- `npm run dev` da solo interroga il Codex reale (`engines:codex-models` avvia l'app server di Codex per elencare i modelli): Codex lo ha considerato vietato e per questo non ha mai lanciato l'app. È una scelta da fare con l'utente, non una regola del progetto.
- Le regole del progetto restano: trattino al posto del trattino lungo, testi dell'interfaccia in inglese, `engines/isolation.ts` non si indebolisce, Full access unico bypass.
- Il test rosso in `tests/main/agent-runner.test.ts` è voluto: non "ripararlo" cambiando l'asserzione, serve l'implementazione.
- `git status` mostra avvisi "LF will be replaced by CRLF": normali su questa macchina.
- Il design ha un solo file di stato di Codex, `.tmp/hos-progress.md`: contiene per ogni task file toccati, controlli e scostamenti. Non è nel repo.
- `PROJECT.md` e `README.md` sono già riscritti per il Head of Staff; un passaggio che nomina ancora "project manager" o "developer di serie" è un residuo da correggere.
