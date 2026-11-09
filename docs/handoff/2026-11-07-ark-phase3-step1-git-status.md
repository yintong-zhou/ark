---
type: handoff
date: 2026-11-07
status: in corso (Fase 3 passo 1: task 1-6 fatti e revisionati, task 7 interrotto a metà)
seq: 6
prev: docs/handoff/2026-11-07-ark-phase2-step2-done.md
tags: [ark, electron, phase3, step1, git, status, staging, commit, diff]
---

# Handoff - Ark Fase 3, passo 1 (Git: stato, staging, commit, diff)

## Obiettivo

La Fase 3 porta Git dentro Ark. Dopo il riepilogo di un thread l'utente deve poter vedere i diff, fare merge del branch `ark/…` del thread, committare e pushare, e rimuovere il worktree senza aprire un'altra app. Oggi il lavoro del developer resta per sempre su un branch e Ark non lo riporta nel branch dell'utente.

- Spec: `docs/superpowers/specs/2026-11-07-phase3-git-design.md`. L'utente ha saltato le domande, quindi le scelte sono mie e nello spec sono marcate **[call]**.
- Piano del passo 1: `docs/superpowers/plans/2026-11-07-phase3-step1-git-status.md`.
- Il passo 2 (branch, fetch/pull/push, worktree, merge del thread) **non ha ancora un piano**.

## A che punto siamo

- **Branch:** `phase3-step1-git-status`, 12 commit da `main` (`0f9fc90..b6281ff`). Non è unito in `main` e non è pushato.
- **Task 1-6** sono fatti con subagent-driven development. Ognuno è passato da review e, dove serviva, da un giro di fix. Gli ultimi controlli girati dai subagenti: typecheck, lint, `npm test` 537/537, build.
  - T1 `src/shared/git.ts`: tipi, parser porcelain v2, `groups`, `letter`, `changedDirs`, `GIT_BUSY`.
  - T2 `src/main/services/git/run.ts` e `repo.ts`: runner senza hook, `GIT_LITERAL_PATHSPECS`, `GIT_TERMINAL_PROMPT=0`, coda per cartella; le operazioni status, show, stage, unstage, discard, commit e mergeAbort.
  - T3 handler `git:*` in `ipc/index.ts`, preload, `ArkApi.git`, `normRels` in `guard.ts`, regola del thread occupato.
  - T4 `src/renderer/git/status-store.ts`: `useGit`, `act`, `show`/`hide`, poll ogni 5 s, debounce di 300 ms, focus.
  - T5 `components/GitView.tsx`, terza vista **Git** nella sidebar, lettere nel `FileTree`, icone.
  - T6 tab di diff: `openDiff` in `tabs-store.ts` e `components/DiffView.tsx` con il diff editor di Monaco.
- **Task 7 (doc + prova nell'app costruita) interrotto** su richiesta dell'utente:
  - `README.md` (nuova sezione `## Git`) e `CLAUDE.md` (layout e regola) sono **modificati ma non committati**. Il testo del README va bene.
  - La riga di layout in `CLAUDE.md` è scritta male ("module-level stores (Git: the status store) for open tabs…"): va riscritta.
  - **La prova CDP nell'app non risulta fatta.** Il subagente non ha scritto il report. Nessun electron di prova è rimasto acceso: ho controllato.
- **Mai provato a mano nell'app:** tutta la vista Git e i diff. Esistono solo i test unitari e la lettura dei revisori.
- **Ancora da provare a mano dall'handoff precedente:**
  - Ctrl+C e Ctrl+V nel terminale;
  - un processo lanciato nella shell che deve morire quando si chiude Ark;
  - Discard changes;
  - la root worktree durante un build.

## Cosa abbiamo provato che NON ha funzionato

- **Mettere in coda ogni singola chiamata git invece di ogni operazione.** Il test "uno status partito durante un commit lo aspetta" fallisce, perché lo status si infila tra `add -A` e `commit`. Adesso ogni operazione di `repo.ts` tiene la coda per tutta la sua durata e dentro usa `gitNow` (non accodato).
- **`rm --cached` senza `-f` per l'unstage prima del primo commit.** Git rifiuta un file modificato dopo lo stage (stato `AM`). Con `--cached`, `-f` non tocca il worktree.
- **`:(top)x.txt` nel test dei nomi strani.** Su NTFS il `:` non si può usare. Su Windows il test usa `[ab].txt` (glob magic) con un esca `a.txt`.
- **Un test della chiave della coda costruito con `join`.** Passava anche con il codice vecchio, perché `join` normalizza già il percorso. Ora usa `join(base,'repo') + sep + '.' + sep`.
- **Ricaricare il diff solo quando cambia lo stato git.** Un file già `M` salvato di nuovo non cambia stato, quindi il diff restava vecchio. Ora DiffView ricarica anche su `files:changed` che tocca il suo rel.

## Problemi incontrati e come li abbiamo risolti

- **Gli status di porcelain sono relativi alla radice del repo, i pathspec alla cwd.** Con una cartella annidata il discard poteva cestinare il file sbagliato. Ora ogni operazione di `repo.ts` rifiuta una cartella senza `.git` ("Open the repository's root folder to use Git"). Il `.git` di un worktree è un file e passa.
- **`git commit` senza niente da committare scrive su stdout.** L'errore era solo "git commit failed". Ora il messaggio è stderr, poi stdout, poi il testo generico.
- **Il poll prendeva `index.lock`** e poteva scontrarsi con il git del terminale dell'utente. Lo status gira con `GIT_OPTIONAL_LOCKS=0`.
- **"Commit all" durante un conflitto** avrebbe committato i marcatori. Main rifiuta con "Resolve the conflicts first". La UI non lo offre, e "stage all" stage solo le righe di Changes.
- **Il banner del merge mostrava il branch corrente.** `GitStatus.mergeHead` viene da `git name-rev --name-only MERGE_HEAD`.
- **Un poll ogni 5 s ri-renderizzava albero e diff.** `refresh()` non emette se lo stato è uguale (confronto JSON).

## Decisioni prese

Nel ledger ci sono 17 righe `Ruling:`. Le principali:

- **Hook: la Git UI non li esegue mai, nemmeno per i commit dell'utente.** La regola viene da `CLAUDE.md`, e la UI lo dice sotto Commit. Scartato: eseguirli per i commit dell'utente, perché gli agenti possono modificare gli hook nel worktree.
- **La regola del thread occupato è stata anticipata dal passo 2 al passo 1**, perché stage e commit nel worktree già fanno a gara con il conductor.
- **Freschezza dello stato: poll ogni 5 s più `files:changed` e focus.** Scartato guardare la git dir: per un worktree vive nel repo principale. Il poll ha un commento `ponytail:`.
- **Status con `GIT_OPTIONAL_LOCKS=0`.** Costo: niente refresh della cache stat dell'indice.
- **Un merge senza conflitti si committa anche senza niente in stage**, altrimenti un merge risolto al contenuto di HEAD resta bloccato. Scartato: lasciarlo disabilitato come diceva alla lettera lo spec §5.1.
- **Il copy del discard di gruppo l'ho scritto io:** "Discard changes to <n> files? New files go to the Recycle Bin; the rest can't be undone."
- **Niente colori per lo stato git**, per il brand ("no new hues"): lettere in muted, `!` in Secondary.
- **Nessuna nuova dipendenza.** Si usa `git` dal PATH con `execFile`.

## File toccati

- `src/shared/git.ts`: nuovo.
- `src/main/services/git/run.ts`, `src/main/services/git/repo.ts`: nuovi.
- `src/main/services/files/guard.ts`: `normRels`.
- `src/main/ipc/index.ts`: gli handler `git:*` e `GIT_BUSY`.
- `src/preload/index.ts`, `src/shared/types.ts`: `ArkApi.git`.
- `src/renderer/git/status-store.ts`: nuovo.
- `src/renderer/components/GitView.tsx`, `DiffView.tsx`: nuovi.
- `src/renderer/components/FileTree.tsx`: lettere e puntini sulle cartelle.
- `src/renderer/components/Icons.tsx`: nuove icone.
- `src/renderer/components/Editor.tsx`: esporta `FONT` e il copy dei placeholder.
- `src/renderer/editor/tabs-store.ts`: `openDiff` e `Doc.diff`.
- `src/renderer/pages/Threads.tsx`: vista Git, il selettore della cartella sopra Files e Git, DiffView.
- Test: `tests/shared/git.test.ts`, `tests/main/git.test.ts` (repo veri in temp), `tests/main/files-guard.test.ts`, `tests/renderer/git-store.test.ts`, `tests/renderer/tabs-store.test.ts`.
- Non committati: `README.md`, `CLAUDE.md`.

## Dove vogliamo andare

1. **Chiudi il Task 7:**
   - sistema la riga di layout in `CLAUDE.md`;
   - fai girare typecheck, lint, test e build;
   - fai la **prova CDP nell'app costruita**: modifica un file, verifica `M` nell'albero e la riga in Changes, apri il diff, fai stage, commit e controlla `No changes`; poi crea un conflitto con git nel terminale e verifica banner con il nome del branch e **Abort merge**; fai uno screenshot;
   - committa `docs: git view`.
2. **Review finale di tutto il branch** (subagent-driven-development, sezione Final Review, modello più capace). Ledger: `.superpowers/sdd/2026-11-07-phase3-step1-git-status/progress.md`, gitignored, e sopravvive. Ha la tabella pre-flight, tutti i `Ruling:` e i minori rimandati da triare. Package: `bash <skill>/scripts/review-package <piano> 0f9fc90~1 HEAD`. Poi un solo giro di fix.
3. **Chiedi all'utente** il fast-forward in `main` e il push, come nei passi precedenti. Riporta le 17 decisioni del ledger ("Rulings I made"), poi cancella la cartella del workspace sdd.
4. **Scrivi il piano del passo 2** con writing-plans: branch, sync, worktree, merge del thread e `build.removed`. Lo spec copre già tutto (§5.1 riga branch, §5.4–§5.7, §6.4).
5. **Minori rimandati da guardare nella review finale (sono nel ledger):**
   - `name-rev` può stampare "undefined": usa `--no-undefined`;
   - "Commit all" disabilitato su un albero pulito: a `all` manca `changes>0`;
   - lo stdout di fallback del runner non ha un tetto;
   - `normRels` accetta i buchi di un array sparso;
   - il test di `useGit` disabilitato non prova niente;
   - `busy` è un booleano.

## Da sapere prima di toccare qualcosa

- **Restano le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - per provare l'app usa `--user-data-dir` nello scratchpad, con `ark-profile` nel nome;
  - commit con `git commit -F` e un file senza BOM;
  - `npm run test:live` costa token: chiedi prima;
  - chiudi l'electron di prova filtrando `*ark-profile*`, mai `Get-Process Ark | Stop-Process`.
- **La ricetta CDP** è nell'handoff precedente (`2026-11-07-ark-phase2-step2-done.md`, ultima sezione). Il driver va riscritto: lo scratchpad non sopravvive.
- **Tutto il git della Git UI passa da `services/git/run.ts`.** `threads/workspace.ts` ha il suo `git()` per il conductor e non va toccato.
- **`repo.ts` non valida i rel:** lo fa l'IPC con `normRels` / `normEntry`, che rifiutano anche il NUL. Il NUL spezzerebbe la lista dei pathspec passata su stdin.
- **`gitRun` e `gitBuffer` esportati non controllano che la cartella sia la radice del repo.** Chi li usa direttamente, come farà il passo 2, deve passare da `inRepo` in `repo.ts`.
- **I test git creano repo veri in `tmpdir`** con `user.name`, `user.email`, `commit.gpgsign=false` e `core.autocrlf=false` locali.
