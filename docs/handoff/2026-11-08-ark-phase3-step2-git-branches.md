---
type: handoff
date: 2026-11-08
status: in corso (Fase 3 passo 2: task 1-5 fatti e revisionati, task 6 e 7 da fare)
seq: 7
prev: docs/handoff/2026-11-07-ark-phase3-step1-git-status.md
tags: [ark, electron, phase3, step2, git, branches, sync, worktree, merge]
---

# Handoff — Ark Fase 3, passo 2 (branch, sync, worktree, merge del thread)

## Obiettivo

La Fase 3 porta Git dentro Ark. Dopo il riepilogo di un thread l'utente deve poter vedere i diff, fare merge del branch `ark/…` del thread nel branch del progetto, committare e pushare, e rimuovere il worktree senza aprire un'altra app.

Il passo 1 (stato, staging, commit, diff) è finito. Il passo 2 aggiunge branch, fetch/pull/push, la gestione dei worktree e il merge del thread.

- Spec: `docs/superpowers/specs/2026-11-07-phase3-git-design.md`.
- Piano del passo 2: `docs/superpowers/plans/2026-11-07-phase3-step2-git-branches-sync.md`.

## A che punto siamo

- **Passo 1 chiuso:**
  - unito in `main` con un fast-forward a `43db19d` e pushato su `origin`;
  - la prova CDP nell'app costruita è passata;
  - la review finale di tutto il branch ha trovato 2 Important, entrambi corretti;
  - l'handoff precedente dice ancora "task 7 in corso": è superato da questo.
- **Branch del passo 2:** `phase3-step2-git-branches`, 10 commit da `main` (`54f69d3..08d1ddf`). Non è unito in `main` e non è pushato. Working tree pulito.
- **Task 1-5:** fatti con subagent-driven development, ognuno con la sua review. Dove serviva c'è stato un solo giro di fix, chiuso da una re-review. Ultimi controlli: typecheck, lint, `npm test` 573/573, build.
  - **T1** `src/shared/git.ts`:
    - `GitBranch`, `GitBranches`, `REFS_FORMAT`, `parseRefs`;
    - `GitWorktree`, `parseWorktrees`, `ThreadBranch`, `WorktreeRow`;
    - `Build.removed?: true` in `shared/thread.ts`.
  - **T2** `repo.ts`:
    - `branches`, `switchBranch`, `createBranch`, `deleteBranch` (restituisce `'deleted' | 'unmerged'`), `fetch`, `pull`, `push`;
    - `unstage` riconosce i conflitti con `ls-files -u`;
    - tolti `gitRun` e `gitBuffer` da `run.ts`.
  - **T3**:
    - in `repo.ts`: `worktrees`, `removeWorktree`, `pruneWorktrees`, `threadBranch`, `mergeBranch` (restituisce `'merged' | 'conflict'`);
    - nuovo `services/git/rules.ts`: `samePath`, `gitRoot` (la regola del thread occupato, spostata da ipc), `worktreeThread`, `checkRemovable`, `checkMergeable`;
    - `rootDir` rifiuta una build `removed`;
    - `Conductor.worktreeRemoved`.
  - **T4**:
    - 12 nuovi canali `git:*` in `ipc/index.ts`, il preload e `ArkApi.git`;
    - `RootWatcher.drop(key)` in `files/watch.ts`.
  - **T5**:
    - la riga del branch con Fetch, Pull e Push in `GitView.tsx`;
    - `BranchMenu` nel nuovo `components/GitSections.tsx`, con tre modalità: lista, crea, elimina;
    - le icone in `Icons.tsx`;
    - due minori dal passo 1: il messaggio di commit resta per ogni root (M3), e un repo annidato appare con il nome della cartella (M4).
- **Da fare:**
  - **T6:** `WorktreesSection` e `ThreadBranchSection` in `GitSections.tsx`, più il selettore della cartella in `Threads.tsx` (sparisce la voce del worktree se `removed`, il callback **Show**, `onConflict` che porta alla root del progetto);
  - **T7:** README e la prova CDP nell'app costruita;
  - poi la review finale del branch.
- **Mai provato nell'app:** tutto il passo 2. Esistono solo i test unitari (veri repo in temp) e le review.

## Cosa abbiamo provato che NON ha funzionato

- **`%(refname:short)` per i nomi dei branch.** Git lo disambigua: un branch `v1` accanto a un tag `v1` diventa `heads/v1`, e poi `switch` e `branch -d` falliscono. I nomi ora vengono dal refname completo.
- **`git merge --no-ff --no-edit <branch>` alla lettera, come nel piano.** Con un tag che ha lo stesso nome git fa il merge del tag. Ora si usa `refs/heads/<b>` con un messaggio esplicito "Merge branch '<b>' into <into>". Per lo stesso motivo `symbolic-ref` gira senza `--short`.
- **Riconoscere gli errori di git dai messaggi in inglese senza fissare la lingua.** Con un git localizzato (verificato con un `git.mo` italiano) `branch -d` lanciava il testo italiano invece di restituire `'unmerged'`. Ora il runner imposta `LC_ALL=C`.
- **`push -u origin <branch>` e `switch <name>`.** Un branch che esiste può iniziare con `-` (un clone con HEAD `refs/heads/--force`, o `update-ref`), e così diventa un'opzione. Ora si usano `push -u origin HEAD`, `switch -- <name>` e `switch --track -- <name>`.
- **`samePath` con `resolve().toLowerCase()`.** Attraverso una junction git stampa il percorso reale e Node no. `worktreeThread` non trovava il thread, e `checkRemovable(undefined)` lasciava rimuovere il worktree di un thread non finito. Ora `samePath` usa `realpathSync.native`, con `resolve` come ripiego.
- **Un solo `watcher.unwatch` prima di `git worktree remove`.** Il watcher conta i riferimenti: tree, status e tabs guardano la stessa root. Con più di un riferimento la cartella non veniva liberata, e se git rifiutava il watch restava spento. Ora c'è `drop(key)`, e su un rifiuto si ripristinano i riferimenti di prima.
- **`mergeBranch` durante un merge già in corso.** Restituiva `'conflict'` anche se del thread non era entrato niente. Ora rifiuta prima con "Finish the merge in progress first".

## Problemi incontrati e come li abbiamo risolti

- **Il controllo "No changes" nel driver CDP del passo 1 era ambiguo.** Lo stesso testo compare anche nella tab del diff dopo lo stage. Ora il driver verifica che la riga sia sparita dalla vista Git e che il commit sia in `git log`.
- **Il diff sembrava senza evidenziazione.** Lo screenshot era partito prima che Monaco finisse di calcolare il diff. Dopo un'attesa di 3 s la decorazione di inserimento c'è.
- **I subagenti scrivono il trailer `Claude Sonnet 5.5`** invece di `Opus 5.5`. È corretto (sono Sonnet): lascialo.

## Decisioni prese

Tutte le righe `Ruling:` sono nel ledger (vedi sotto). Le principali del passo 2:

- **Il sync resta nella coda della cartella.** Un push lento blocca stage e commit fino a 2 minuti, mentre il suo pulsante gira. Scartato: farlo girare fuori dalla coda, che avrebbe richiesto un controllo del repo separato.
- **`LC_ALL=C` su ogni chiamata git.** Gli errori di git si vedono sempre in inglese, ma la UI è già in inglese. Scartato: cercare il testo localizzato.
- **`push -u origin HEAD`** al posto del `push -u origin <branch>` del piano: stesso upstream, e nessun nome sulla riga di comando.
- **Riferimenti completi per `threadBranch` e `mergeBranch`**, con un messaggio di merge esplicito.
- **`samePath` con realpath** al posto del `resolve` del piano.
- **`RootWatcher.drop` più il ripristino** al posto del singolo `unwatch` del piano. In più il thread proprietario si cerca solo tra quelli del progetto.
- **Il menu dei branch è un popup nuovo.** Il `Menu` attuale non può contenere un campo di testo né un sottomenu.
- **Il Task 3 tocca anche `ipc/index.ts`** (`gitDir` ora passa da `gitRoot`). Il piano lo diceva in uno step ma non nella lista dei file.
- **I task 4-6 non hanno test unitari.** Non esiste un harness per ipc né per il render di React. Le regole stanno in `rules.ts`, che è testato, e la UI si prova nel T7 via CDP.
- **I testi nuovi** (conferme, errori, etichette) sono miei e sono nelle Global Constraints del piano.
- **Dal passo 1, ancora rimandati:** M5 (Discard all cestina un file alla volta) e i minori di test e cosmetica.

## File toccati

- `src/shared/git.ts`: tipi e parser per branch e worktree.
- `src/shared/thread.ts`: `Build.removed`.
- `src/main/services/git/run.ts`: `LC_ALL=C`; tolti `gitRun` e `gitBuffer`.
- `src/main/services/git/repo.ts`: le operazioni su branch, sync, worktree e merge; `unstage` con `ls-files -u`.
- `src/main/services/git/rules.ts`: nuovo, con le regole dei thread e `samePath`.
- `src/main/services/files/guard.ts`: `rootDir` rifiuta una build `removed`; il tipo `RootStore`.
- `src/main/services/files/watch.ts`: `drop(key)`.
- `src/main/services/threads/conductor.ts`: `worktreeRemoved`.
- `src/main/ipc/index.ts`: 12 canali, `branchArg` e `pathArg`, `gitDir` che passa da `gitRoot`.
- `src/preload/index.ts`, `src/shared/types.ts`: `ArkApi.git` esteso.
- `src/renderer/components/GitView.tsx`: riga del branch, sync, M3, M4.
- `src/renderer/components/GitSections.tsx`: nuovo, con `BranchMenu`.
- `src/renderer/components/Icons.tsx`: Fetch, Pull, Push.
- Test:
  - `tests/shared/git.test.ts`;
  - `tests/main/git.test.ts` (con un `origin` bare locale);
  - `tests/main/git-rules.test.ts` (nuovo, con una junction vera);
  - `tests/main/files-guard.test.ts`, `tests/main/files-watch.test.ts`, `tests/main/conductor.test.ts`.
- `docs/superpowers/plans/2026-11-07-phase3-step2-git-branches-sync.md`: il piano.

## Dove vogliamo andare

1. **Riprendi subagent-driven development dal Task 6.**
   - Ledger: `.superpowers/sdd/2026-11-07-phase3-step2-git-branches-sync/progress.md`. È gitignored e sopravvive. Contiene la tabella pre-flight, tutti i `Ruling:`, i minori rimandati e la lista "to check in Task 7".
   - Nella stessa cartella trovi i file pronti da passare ai subagenti:
     - `common.md`, le regole per gli implementer;
     - `global-constraints.md`;
     - `reviewer-rules.md` e `rereview-rules.md`, i template di review già estratti.
   - Brief: `bash <skill>/scripts/task-brief <piano> 6`, dove `<skill>` è `C:\Users\zhouy\.claude\plugins\cache\claude-plugins-official\superpowers\7.0.0\skills\subagent-driven-development`.
   - BASE del Task 6: `08d1ddf`.
2. **Task 7:** README, poi la prova CDP nell'app costruita (lo scenario è nel piano). Tieni conto dei punti ⚠️ nel ledger:
   - i `confirm()` nativi vanno gestiti con `Page.javascriptDialogOpening` e `Page.handleJavaScriptDialog`;
   - la riga di un repo annidato (`dir/`), con Open file e il clic sul diff, deve fallire senza danni;
   - spinner, Escape e clic fuori dal menu;
   - `switchBranch` con track su `origin/feat`.
3. **Review finale di tutto il branch** sul modello più capace: package `review-package <piano> 43db19d HEAD`, poi un solo giro di fix e una re-review.
4. **Chiedi all'utente** il fast-forward in `main` e il push. Riporta tutti i `Ruling:` del ledger ("Rulings I made"), poi cancella la cartella sdd.

## Da sapere prima di toccare qualcosa

- **Restano le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - per provare l'app usa `--user-data-dir` nello scratchpad, con `ark-profile` nel nome;
  - commit con `git commit -F` e un file senza BOM;
  - `npm run test:live` costa token: chiedi prima;
  - chiudi l'electron di prova filtrando `*ark-profile*` in `Win32_Process`, mai `Get-Process Ark | Stop-Process`.
- **Ricetta CDP:**
  - build e avvio: `npm run build`, poi `$env:ELECTRON_RENDERER_URL=''` e `Start-Process node_modules\electron\dist\electron.exe -ArgumentList ".","--user-data-dir=<profilo>","--remote-debugging-port=9333"`;
  - profilo: `<profilo>\projects.json` = `[{id, name, dir, git:true}]`;
  - un thread finto si scrive in `<profilo>\threads\<uuid>\thread.json`;
  - driver: Node con `fetch` e `WebSocket` globali e le funzioni `ev`, `until` (le espressioni devono tornare booleani), `click`, `clickText` e `shot`. Il driver del passo 1 era nello scratchpad e non sopravvive: va riscritto;
  - i pulsanti della sidebar sono `role=tab` con il testo Threads, Files o Git.
- **Il runner di git:** ogni operazione di `repo.ts` è un solo `inRepo` (coda per cartella più controllo della radice), e dentro usa `gitNow`/`refs`/`listWorktrees`. Chiamare `branches()` o `status()` lì dentro va in deadlock.
- **Il watcher conta i riferimenti.** Non chiamare `unwatch` per "liberare" una cartella: usa `drop`.
- **`threads/workspace.ts`** ha il suo `git()` per il conductor e non va toccato.
