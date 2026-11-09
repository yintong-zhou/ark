---
type: handoff
date: 2026-11-08
status: Fase 3 chiusa (unita in main e pushata); prossima la Fase 4
seq: 8
prev: docs/handoff/2026-11-08-ark-phase3-step2-git-branches.md
tags: [ark, electron, phase3, git, done, phase4, browser]
---

# Handoff - Ark Fase 3 chiusa, si riparte dalla Fase 4

## Obiettivo

Ark mette Claude Code, Codex e OpenCode in un'unica app desktop. La Fase 3 ha portato Git dentro Ark: dopo il riepilogo di un thread l'utente vede i diff, fa il merge del branch `ark/…` del thread, committa, pusha e rimuove il worktree senza aprire un'altra app.

La prossima milestone di `PROJECT.md` è la **Fase 4: un browser integrato con selezione di un'area**.

## A che punto siamo

- **Fase 3 completa.** Spec `docs/superpowers/specs/2026-11-07-phase3-git-design.md` §8: due passi, entrambi fatti.
  - **Passo 1** (stato, staging, commit, diff): in `main` dall'handoff precedente.
  - **Passo 2** (branch, sync, worktree, merge del thread): unito in `main` con un fast-forward a `3e9e60a` e pushato su `origin`.
- **Verifica del passo 2:**
  - typecheck e lint puliti, `npm test` 579/579, build ok;
  - prova CDP nell'app costruita superata su tutti gli scenari del piano;
  - review finale su Opus: 2 Important corretti e riverificati.
- **Working tree:** pulito, su `main`.
- **Branch locali ancora presenti, tutti già uniti:** `phase2-step1-files-editor`, `phase3-step1-git-status`, `phase3-step2-git-branches`. Si possono cancellare se l'utente lo chiede.
- **Workspace sdd:** `.superpowers/sdd/2026-11-07-phase3-step2-git-branches-sync` è stato cancellato. I Minor rimandati sono riportati sotto.
- **Fase 4:** non iniziata. Non ci sono né spec né piano.

## Cosa abbiamo provato che NON ha funzionato

Sono quelle del passo 2, valgono per ogni codice git futuro. L'elenco completo è nell'handoff `seq: 7`.

- `%(refname:short)`: un tag con lo stesso nome lo rende ambiguo. Ora i nomi vengono dal refname completo.
- `git merge <branch>` alla lettera: con un tag omonimo fa il merge del tag. Ora si usa `refs/heads/<b>`.
- Riconoscere gli errori di git dal testo inglese senza fissare la lingua: con un git localizzato non funziona. Ora c'è `LC_ALL=C`.
- Nomi di branch passati come argomenti nudi: un nome che inizia con `-` diventa un'opzione. Ora c'è `--`, e il push usa `push -u origin HEAD`.
- `samePath` con `resolve().toLowerCase()`: fallisce attraverso le junction. Ora usa `realpathSync.native`.
- Un solo `watcher.unwatch` prima di rimuovere un worktree: il watcher conta i riferimenti, quindi la cartella non veniva liberata. Ora c'è `drop(key)` più il ripristino.
- Assumere che un `git worktree remove` fallito lasci il worktree intatto. **Falso su Windows:** se la cartella è tenuta aperta, git cancella i file e la voce del worktree, esce con 255 e la cartella vuota resta.
  - Prima il thread restava bloccato.
  - Ora `services/git/worktrees.ts` riconcilia dopo ogni Remove e ogni Prune: ogni thread il cui worktree non è più nella lista viene segnato `build.removed`. Il messaggio è `Worktree removed, but its folder is in use. Close what holds it to delete it.`
- Cercare il thread proprietario di un worktree solo tra i thread del progetto: con due progetti sullo stesso repo si saltava il controllo "thread finito". Ora la ricerca va su tutti i thread.

## Problemi incontrati e come li abbiamo risolti

- **Exit code 255 dopo `git push` in PowerShell 5.1.** È solo lo stderr di git trattato come errore, e il push riesce. Si verifica dall'output `old..new main -> main`.
- **Un controllo CDP fallito per un timing.** Le righe dei worktree si caricano in modo asincrono: il driver deve usare `until(...)` sulle righe, non uno screenshot immediato.
- **Il fix di un regex scritto da un subagente** aveva perso il backslash (`[\/]` al posto di `[\\/]`). Dopo un fix su regex verifica il sorgente con grep.

## Decisioni prese

Le decisioni del passo 2 sono riportate nella chat finale della sessione ("Rulings I made", 17 voci). Quelle che restano vive:

- **Riconciliazione invece di rifiuto preventivo.** Non si rifiuta Remove se un terminale di Ark è aperto sul thread: si riconcilia dopo. Costo: una cartella vuota può restare su disco.
- **Lasciati com'è, consapevolmente:**
  - un percorso non elencato da git, mandato dal renderer, può segnare come rimosso un thread finito di un altro repo. Lo raggiunge solo un payload IPC costruito apposta, e nessun file viene toccato. La correzione stretta: riconciliare il percorso richiesto solo se il progetto del suo thread è quella cartella;
  - le code di due cartelle possono bloccarsi a vicenda se due progetti sono worktree collegati l'uno del repo dell'altro e l'utente li rimuove a vicenda nello stesso momento.
- **Il sync resta nella coda della cartella.** Un fetch o push lento, fino a 120 s, blocca status e diff di quella root. Scartato: farlo girare fuori dalla coda.
- **Minor rimandati**, giudicati "possono aspettare" dalla review finale:
  - il menu dei branch elenca anche i branch in uso in altri worktree e, se se ne sceglie uno, mostra l'errore grezzo `fatal: … already used by worktree`. Correzione: `%(worktreepath)` in `REFS_FORMAT`, e disabilitare quelle voci;
  - repo annidato `dir/`: la tab del diff si chiama solo "(changes)", perché `nameOf` in `tabs-store.ts:86` non toglie la `/` finale. Inoltre Open file mostra l'errore grezzo `EISDIR`;
  - le righe dei worktree troncano prima il branch, perché i tre span hanno tutti `truncate`;
  - un timeout del sync si legge come "git fetch failed". Correzione da una riga: `err.killed` → "timed out", in `run.ts:33`;
  - Prune e Remove nella riga della sezione Worktrees, e i percorsi Cancel dei confirm, non sono mai stati provati via CDP;
  - il confirm di un worktree detached dice "The branch HEAD stays.";
  - `pathArg` accetta percorsi relativi. È innocuo, ma `isAbsolute` lo renderebbe stretto;
  - un remote SSH che chiede la passphrase può bloccarsi fino al timeout, perché `GIT_TERMINAL_PROMPT=0` non copre SSH. Non verificato;
  - i minori di UI del menu dei branch: il titolo è "Branches" invece del nome del branch; il focus non torna al pulsante; il testo del campo sopravvive a Escape;
  - l'altezza dei controlli condivisi è `h-4` (32px) contro gli `h-3` delle righe chiesti dal piano.

## File toccati

In questa sessione, oltre al passo 2 già descritto in `seq: 7`:

- `src/renderer/components/GitSections.tsx`: `WorktreesSection`, `ThreadBranchSection`, i pulsanti che vanno a capo, lo stato "occupato" su Remove worktree.
- `src/renderer/components/GitView.tsx`: le props `projectId`, `thread`, `onShowThread` e `onConflict`.
- `src/renderer/pages/Threads.tsx`: il selettore lascia cadere un worktree `removed`; lo stato `wanted` per **Show**; `onConflict` porta alla root del progetto.
- `src/main/services/git/worktrees.ts`: nuovo. Remove e Prune con drop del watcher, ripristino e riconciliazione dei thread.
- `src/main/services/git/rules.ts`: `removable(t)`, una sola regola per la UI e per main.
- `src/main/ipc/index.ts`: i gestori dei worktree passano da `worktrees.ts`.
- `tests/main/git.test.ts`: 6 test su worktree e riconciliazione, compresa una cartella tenuta aperta da un processo figlio.
- `README.md`: la sezione `## Git` (branch, sync, worktree, merge del thread).

## Dove vogliamo andare

1. **Inizia la Fase 4 (browser integrato con selezione di un'area) con `superpowers:brainstorming`.** Leggi prima:
   - `PROJECT.md`, cioè lo scope e le "extra features";
   - `README.md`;
   - `CLAUDE.md`, per la sicurezza: CSP, `contextIsolation`, link esterni solo tramite allowlist.

   Il browser integrato tocca proprio queste regole, quindi decidi con l'utente:
   - `WebContentsView` o `<webview>`;
   - cosa succede all'area selezionata, per esempio uno screenshot o un elemento passato come contesto al thread.
2. Poi la spec in `docs/superpowers/specs/`, il piano in `docs/superpowers/plans/` e l'esecuzione con subagent-driven development, come nelle fasi 2 e 3.
3. Facoltativo, se l'utente lo chiede: un passo di rifinitura Git con i Minor elencati sopra. Il più utile è il menu dei branch con `%(worktreepath)`.

## Da sapere prima di toccare qualcosa

- **Restano le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - per provare l'app usa `--user-data-dir` nello scratchpad, con `ark-profile` nel nome;
  - chiudi l'electron di prova filtrando `*ark-profile*` in `Win32_Process`, mai `Get-Process Ark | Stop-Process`;
  - commit con `git commit -F` e un file senza BOM;
  - `npm run test:live` costa token: chiedi prima.
- **Ricetta CDP:** è nell'handoff `seq: 7`, sezione "Da sapere". I driver vivono nello scratchpad e non sopravvivono alla sessione. Per i `confirm()` nativi usa `Page.javascriptDialogOpening` e `Page.handleJavaScriptDialog`.
- **Git dell'app:** ogni operazione di `repo.ts` è un solo `inRepo`. Chiamare `branches()` o `status()` lì dentro va in deadlock. La rimozione di un worktree prende prima la coda del worktree, poi quella del progetto.
- **Il watcher conta i riferimenti.** Per liberare una cartella usa `drop`, non `unwatch`.
- **I subagenti firmano `Claude Sonnet 5.5`** nel trailer quando girano su Sonnet. È corretto.
