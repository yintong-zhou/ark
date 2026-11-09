---
type: handoff
date: 2026-11-09
status: review-completata
seq: 11
prev: docs/handoff/2026-11-09-browser-git-polish.md
tags: [ark, threads, task-board, kanban]
---

# Handoff - Task board dei thread

## Ripresa e review - 2026-11-09

- Review completata, inclusi i file nuovi e la conservazione dei task in `Conductor.save()`.
- Corretto un difetto riprodotto nella UI: tornando da Tasks a Conversation, le conversazioni lunghe ripartivano
  dal primo messaggio. L'effetto di scroll ora dipende anche dalla vista aperta e mostra gli ultimi messaggi.
- Aggiunto un test con developer simulato: creazione, modifica e cancellazione dei task conservano le approvazioni
  pendenti; le risposte alle approvazioni e il salvataggio di fine turno conservano la board aggiornata.
- Verifiche finali: **typecheck, lint, build e suite completa 48 file / 686 test passati** (200,25 s).
  Anche gli **88 test mirati** conductor/task passano. La suite nel sandbox è stata interrotta dopo un timeout
  di `session-kill.test.ts`; il risultato completo proviene dal run fuori dal sandbox.
- Prova dev sul profilo temporaneo verificato: CRUD, assegnazione, reload, conferma delete, rifiuti IPC,
  colonne di almeno 200 px con scroll nel pannello stretto e ritorno agli ultimi messaggi. Screenshot ispezionato.
  Il driver aggiuntivo `.tmp/task-board-review.cjs` riproduceva il difetto di scroll prima della correzione e ora passa;
  conserva/ripristina le fixture temporanee. L'istanza dev è stata chiusa verificando il profilo.
- Restano soltanto l'eventuale consegna Git richiesta dall'utente e la scelta del prossimo extra.
  Nessun commit, push, PR o test live eseguito; `AGENTS.md` preesistente lasciato invariato.

## Obiettivo

Ark riunisce agenti di coding, conversazioni e strumenti del progetto in una sola app desktop Windows.
Dopo le fasi 0–4, l'utente ha scelto esplicitamente **Task board con attività assegnate agli agenti** come prossimo
requisito di `PROJECT.md`, per rendere visibili attività, responsabilità e avanzamento nel thread.

## A che punto siamo

- Branch attuale **`main`**, HEAD **`48c0b4a`**, merge della PR #2 browser/Git. La task board è una modifica locale
  **non committata**: nessun nuovo branch, commit, push, merge o PR in questa sessione.
- Apri un thread e premi **Tasks (n)**; **Conversation** torna ai messaggi. Board con **To do / In progress / Done**,
  creazione, titolo modificabile, assegnazione opzionale a un membro del team approvato, cambio stato e cancellazione
  con conferma. Colonne larghe almeno circa 200 px, con scorrimento orizzontale nei pannelli stretti.
- `Thread.tasks?` conserva le attività in `thread.json`, senza migrazione obbligatoria per i thread vecchi.
  Limiti: 100 attività per thread, titolo massimo 200 caratteri. Validazione in main e UUID nel contratto IPC.
- Le modifiche non avviano né interrompono turni. Ogni agente riceve la board corrente al turno successivo,
  dopo cronologia/handoff, anche nelle sessioni build nuove. Dopo l'ultima cancellazione riceve una board vuota
  esplicita. I salvataggi di un turno in corso conservano le attività aggiornate su disco.
- `PROJECT.md` e `README.md` aggiornati. Nessuna nuova dipendenza o modifica all'isolamento degli agenti.
- Verifiche: **typecheck, lint, build passati**; suite completa **48 file / 685 test passati** (238,71 s).
  Dopo l'ultimo riordino del contesto agenti: typecheck, lint, build e **87 test mirati** ripassati.
- Prova dev riuscita su profilo temporaneo: creazione, assegnazione, spostamento, modifica, completamento,
  persistenza dopo reload, conferma/cancellazione. IPC rifiuta stato invalido, agente fuori dal team e task di
  un altro thread. Nessun messaggio/turno agente avviato dai thread finti. Screenshot ispezionato.
- L'istanza dev di prova è stata chiusa verificando prima il suo `userData`. Nessun test live eseguito.
- `AGENTS.md` era già non tracciato prima del lavoro: lasciato invariato, non includerlo automaticamente nei commit.

## Cosa abbiamo provato che NON ha funzionato

- **Electron nel sandbox Windows**: arresto fatale `install_dir_access.cc` per ACL della cartella Electron.
  Avvio dev fuori dal sandbox autorizzato dalla revisione automatica; non cambiare ACL e non disabilitare il sandbox
  dell'app per risolvere questo problema dell'ambiente.
- **Tre colonne basate sulla larghezza della finestra** (`md:grid-cols-3`): il pannello centrale è molto più stretto
  della finestra, quindi i titoli si spezzavano in poche lettere. Sostituito con una griglia interna di minimo 640 px
  e contenitore con scroll orizzontale; metadati dell'header ridotti a `Task board` mentre la board è aperta.
- **Screenshot CDP con i parametri predefiniti**: timeout. Nel driver la finestra viene mostrata/focalizzata e si usa
  `Page.captureScreenshot({ format: 'png', fromSurface: false })`. Nessun override del codice di produzione.
- **Driver iniziale**: selezione del thread dal testo esatto falliva per il prefisso `#`; usa anche il `title` del
  pulsante. Corretti escape dei selettori CSS nelle espressioni CDP. Un run interrotto lasciava board aperta/task
  persistiti: il driver finale ricarica il renderer e cancella solo le attività del proprio thread finto prima del test.

## Problemi incontrati e come li abbiamo risolti

- Un turno mantiene una copia vecchia del thread: `Conductor.save()` ora riprende anche `tasks` dal thread su disco,
  come già faceva per tag e approvazioni. Test copre modifica e cancellazione durante un turno ancora in attesa.
- Un agente con sessione viva potrebbe ricordare task eliminati: dopo una cancellazione totale viene passato
  `Current task board: no tasks`, che sostituisce le board precedenti.
- Le sessioni build nuove possono saltare il transcript e gli handoff possono ricordare versioni vecchie: la snapshot
  corrente viene aggiunta a ogni input dopo cronologia/handoff, anziché affidarsi solo ai messaggi non letti.

## Decisioni prese

- **Board per thread**, anziché board globale del progetto: riusa team, salvataggio e aggiornamenti già esistenti.
- **Gestione manuale dell'utente**, anziché scheduler o nuovo protocollo di comandi agenti: assegnare chiarisce la
  responsabilità, ma non cambia il turno deciso dal conductor e non aggira approvazioni o permessi.
- **Array opzionale in `thread.json`**, anziché database/file nuovo o ricostruzione da eventi nel transcript:
  persistenza atomica e compatibilità con thread esistenti usando `ThreadStore`.
- **Snapshot corrente per turno**, anziché sole note di modifica: funziona anche con sessioni nuove, handoff e build.
- **Select per spostare le schede**, anziché drag-and-drop: accessibile da tastiera, senza nuove dipendenze.
- Gli extra successivi (memoria condivisa, checkpoint/rollback, esecuzione OpenCode, setup API key) **non sono stati
  scelti né implementati**. Non dedurre una nuova priorità da questo handoff.

## File toccati

- `src/shared/thread.ts`: tipi `TaskStatus`, `TaskInput`, `ThreadTask` e campo opzionale `Thread.tasks`.
- `src/shared/tasks.ts` **nuovo**: validazione payload, etichette degli stati e snapshot testuale per gli agenti.
- `src/main/services/threads/conductor.ts`: CRUD task, controllo team/limiti, merge dai dati correnti e contesto agenti.
- `src/main/ipc/index.ts`: canali `threads:save-task` / `threads:remove-task`, UUID thread/task validati.
- `src/shared/types.ts`: API tipizzata `saveTask` / `removeTask`.
- `src/preload/index.ts`: bridge ristretto dei due canali.
- `src/renderer/components/TaskBoard.tsx` **nuovo**: form, colonne, edit, stato, assegnazione e conferma delete.
- `src/renderer/components/ThreadView.tsx`: pulsante Tasks/Conversation e visualizzazione della board.
- `tests/shared/tasks.test.ts` **nuovo**: payload invalidi, normalizzazione e formato della snapshot.
- `tests/main/conductor.test.ts`: CRUD/persistenza, limiti/team, aggiornamenti durante un turno e contesto build.
- `README.md`: istruzioni della task board e relativi limiti.
- `PROJECT.md`: priorità extra scelta e scope della board.
- `docs/handoff/2026-11-09-thread-task-board.md`: questo handoff, sequenza 11.
- `.tmp/task-board-*`: driver e profilo di verifica ignorati da Git, non parte della consegna.

## Dove vogliamo andare

1. **Review locale e prove dev completate** nella ripresa descritta sopra. I motori reali restano da verificare
   soltanto se l'utente autorizza il consumo di token.
2. **Consegna la modifica con il flusso Git richiesto dall'utente.** Non sono stati richiesti commit, push o merge
   per la task board. Prima di pubblicare verifica lo stato corrente; escludi `AGENTS.md` preesistente e `.tmp/`.
3. **Concorda la prossima funzionalità extra** solo dopo la review della board: nessuna nuova milestone è stata scelta.

## Da sapere prima di toccare qualcosa

- Leggi `AGENTv2.md`, `AGENTS.md` e `brand-guidelines.md`. Skill ponytail usata per il codice; handoff richiesto
  esplicitamente per chiudere questa sessione. Nessun subagente è stato usato.
- PowerShell blocca `npm.ps1`: usa **`npm.cmd`**. Check: `npm.cmd run typecheck`, `npm.cmd run lint`,
  `npm.cmd test -- --testTimeout 120000 --hookTimeout 120000`, `npm.cmd run build`.
  Timeout alti solo per il comando di verifica; configurazione del progetto invariata.
  I test Git/filesystem completi sono stati eseguiti fuori dal sandbox. **Non eseguire `test:live` senza chiedere.**
- Driver ignorato `.tmp/task-board-check.cjs`: `node .tmp/task-board-check.cjs setup` genera il profilo,
  `node .tmp/task-board-check.cjs` esegue le prove; `.tmp/task-board-close.cjs` chiude la sola istanza verificata.
  Config `.tmp/task-board-check.json`, profilo della prova:
  `C:\Devs\Personal\ark\.tmp\task-board-eQKWhc\ark-profile-board`; screenshot `board.png` nella cartella padre.
- Avvio dev corretto (porte driver: renderer **9553**, main inspector **9559**):

  ```powershell
  $boardCheck = Get-Content .tmp/task-board-check.json | ConvertFrom-Json
  npm.cmd run dev -- --inspect 9559 --remoteDebuggingPort 9553 -- "--user-data-dir=$($boardCheck.profile)"
  ```

  Prima di qualsiasi prova, **asserisci** `app.getPath('userData') === profile` tramite inspector. I thread finti sono
  `phase: 'done'`, `status: 'idle'`, quindi non avviano motori. Non terminare Electron/Node in blocco.
- **Non affidarti a `ELECTRON_CLI_ARGS` da solo**: electron-vite può sovrascriverlo. Nella verifica browser precedente
  questo errore aveva aperto per sbaglio il profilo reale e aggiornato automaticamente cronologia usage e dati Electron;
  l'errore è stato dichiarato all'utente. La prova task board ha usato e verificato il profilo temporaneo corretto.
  Non scrivere nel profilo reale, in `~/.claude` o `~/.codex`.
- Contesto browser ereditato: PR #2 già in main, cattura nativa riuscita dopo retry, ma il primo Select automatizzato
  può ancora produrre `UnknownVizError`. L'utente ha detto **«Non l'ho ancora provato»** nell'uso manuale. Tastiera
  fisica e riproduzione manuale restano da verificare; non sono parte della nuova task board.
- Nessun problema di test lasciato aperto. Restano review/consegna della modifica locale e scelta del prossimo extra.
