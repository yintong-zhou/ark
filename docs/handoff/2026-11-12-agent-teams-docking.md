---
type: handoff
date: 2026-11-12
status: in corso
seq: 1
prev: nessuno
tags: [ark, agents, ui, docking]
---

## Obiettivo

Rendere la pagina Agents gestibile con molti agenti (team creati dall'utente, uno per agente) e rifinire la UI di Ark: stile 3D coerente per drop-down e gruppi di pulsanti, dimensioni dei pannelli ricordate, pannelli (terminale, Workspace) spostabili come in Visual Studio.

## A che punto siamo

Pushato su `feat/agent-teams-grouping` (commit `ceed30a`, `3d0487c`): team degli agenti, tasti Indietro/Avanti, migrazione IT Services.

**Non committato** (working tree, tutto passa: typecheck, lint, 970 test, build):
- fix migrazione IT Services (parte se non ci sono team, non solo se manca il file)
- tasti Indietro/Avanti spostati nel Rail sopra il logo
- `Menu.tsx`: gap tra le voci
- nuovo `Select` (menu Ark al posto dei `<select>` nativi) applicato ovunque
- dimensioni ricordate: sidebar, altezza terminale (localStorage), finestra (`window-state.json`)
- docking: menu "Move" e drag-and-drop (maniglia ⠿) per terminale (4 lati) e Workspace (destra/sinistra)

**Mai provato nell'app reale** (nessun `npm run dev` lanciato in questa sessione): tutto il comportamento visivo, il drag-and-drop, il ripristino della finestra.

## Cosa abbiamo provato che NON ha funzionato

- Migrazione IT Services condizionata a `agent-teams.json` assente: il file esisteva già vuoto (`teams: []`), quindi non scattava mai. Ora la condizione è `teams.length === 0`.
- Salvare la finestra solo alla chiusura: nel file risultava 1200x760 (default) con x=1613 (secondo monitor). Ipotesi (non verificata): scala DPI diversa sul secondo monitor. Fix applicato: `setBounds` dopo la creazione e salvataggio su resized/moved/maximize. **L'utente non ha ancora confermato che funzioni.**
- `w-40` sui drop-down: in questo progetto l'unità è 8 px, quindi 320 px. Tolta la larghezza fissa.
- Refs letti in render (hook lint `react-hooks/refs`) per i tasti back/forward: sostituiti con uno stato unico `{trail, at}`.

## Problemi incontrati e come li abbiamo risolti

- Bash tool: heredoc con apostrofi nel testo → "unexpected EOF". Usare Write per i file, o uno script `.mjs` scritto con heredoc quotato.
- File con CRLF: gli script di modifica devono normalizzare `\r\n` prima del `replace` (c'è una funzione `rep` ripetuta nei vari script). Python non è installato.
- `git add -A` include il lavoro pre-esistente dell'utente (Settings, tema): è stato scelto consapevolmente nel primo commit.

## Decisioni prese

- Un team per agente (non multi-membership); scartato: multi-membership, perché una sezione per team non vuole duplicati.
- `AgentTeamsStore` creato dentro `registerIpc`, non in `index.ts` (un file in meno).
- Migrazione IT Services quando non ci sono team; scartato: un marcatore "migrato". Limite noto (commento `ponytail:` in `ipc/index.ts`): cancellando tutti i team, IT Services ricompare.
- Docking semplificato: dock side per pannello, non una griglia. Terminale: bottom/top/left/right dentro l'area del thread; Workspace: right/left. Scartati: Workspace in alto/basso, più pannelli sullo stesso lato (richiede un vero layout manager).
- Tag filtro dei thread (`#tag`) lasciati pillole piatte (toggle multipli che vanno a capo).

## File toccati

- `src/shared/agent-teams.ts`, `tests/shared/agent-teams.test.ts`: logica pura dei team.
- `src/main/services/agent-teams.ts`, `tests/main/agent-teams.test.ts`: store su `agent-teams.json`.
- `src/main/ipc/index.ts`: canali `catalog:agent-teams` / `catalog:save-agent-teams`, migrazione, pulizia su remove / add-team.
- `src/main/index.ts`: stato della finestra (`window-state.json`).
- `src/renderer/pages/Agents.tsx`, `components/AgentTeamSection.tsx`, `hooks/useCatalog.ts`: pagina raggruppata.
- `src/renderer/components/Select.tsx` (nuovo), `Menu.tsx`, `AgentFields.tsx`, `Cards.tsx`, `TaskBoard.tsx`, `pages/AgentForm.tsx`: drop-down Ark.
- `src/renderer/components/DockMenu.tsx` (nuovo, esporta `DockControls`), `TerminalPanel.tsx`, `terminal/terms-store.ts`, `Shell.tsx` (props `widthKey`, `order`), `pages/Threads.tsx`: docking.
- `src/renderer/saved.ts` (nuovo): `loadSize/saveSize/loadChoice/saveChoice` su localStorage.
- `src/renderer/App.tsx`, `components/Rail.tsx`, `components/Icons.tsx`: cronologia Indietro/Avanti.
- `src/renderer/components/ThreadView.tsx`: reazioni con pista incassata.
- `README.md`, `CLAUDE.md`: docs dei team.

## Dove vogliamo andare

1. Lanciare `npm run dev` e provare a mano: team (crea, sposta, ricarica, elimina), migrazione IT Services, drop-down Ark, drag-and-drop dei pannelli, chiusura e riapertura con finestra ridimensionata (anche sul secondo monitor).
2. Se la finestra non torna alla dimensione: chiedere su quale monitor e con che scala, e leggere `%APPDATA%\ark\window-state.json` dopo la chiusura.
3. Committare in un colpo solo il lavoro non committato e fare push (la PR non è ancora aperta).
4. Poi, se serve: Workspace in alto/basso, spaziature di altre sezioni (l'utente deve mandare screenshot), tag filtro nello stile segmentato.

## Da sapere prima di toccare qualcosa

- Unità di spaziatura Tailwind = 8 px (`size-4` = 32 px, `w-40` = 320 px).
- Commit: messaggio via file (`git commit -F`), senza BOM, con la riga `Co-Authored-By` richiesta; trattini al posto dei trattini lunghi.
- `Menu` nasconde le pagine browser native tramite `useOverlay`; ogni popup nuovo che può coprire il browser deve usarlo.
- `npm run test:live` costa token: non lanciarlo senza chiedere.
