---
type: handoff
date: 2026-11-09
status: pronto-per-review
seq: 10
prev: docs/handoff/2026-11-08-ark-phase4-browser-done.md
tags: [ark, browser, git, selezione, rifiniture]
---

# Handoff — Rifiniture del browser e dei branch Git

## Obiettivo

Ark riunisce gli agenti di coding e gli strumenti del progetto in una sola app desktop. Dopo le quattro fasi principali,
stiamo correggendo gli inconvenienti emersi dalle review: inviare immagini e riferimenti coerenti dal browser al thread
e rendere leggibili i vincoli dei worktree nel menu Git.

## A che punto siamo

- L'handoff precedente era superato: la Fase 4 è già stata unita in `main` dalla PR #1, commit `efc57e9`.
- Branch di consegna di questa sessione: **`polish/browser-git-2026-11-09`**, da quel `main`. Nessun merge in `main` e nessuna nuova PR.
- L'utente ha chiesto esplicitamente questo handoff e il push delle modifiche su un branch nuovo.
- Browser: suggerimento di selezione nella barra degli indirizzi; avviso di redirect pulito dopo una navigazione locale;
  focus al commento dopo ogni drag; selezione e cattura in attesa annullate se la pagina fallisce, conservando il commento.
- Ogni cattura porta `id`, `frame`, `url`, `width`, `height`. Main conserva anche bounds, rapporto di zoom e contatore
  delle navigazioni. `pick(projectId, captureId, rect)` rifiuta una cattura sostituita e ritaglia con i bounds catturati.
- Il messaggio usa l'URL della cattura. Se la pagina naviga, viene ricaricata allo stesso URL o cambia dimensioni/zoom,
  non viene aggiunta una descrizione ricavata dalla pagina successiva. Il PNG della cattura resta utilizzabile.
- Un resize dell'area selezionabile annulla la selezione e conserva il commento. La cancellazione è rinviata al frame
  successivo e il callback viene cancellato all'unmount, per evitare un loop di `ResizeObserver`.
- Niente catture duplicate mentre una è in attesa; Esc annulla anche l'attesa. Risposte tardive dopo annullamento,
  errore o chiusura non riaprono la selezione. Gli eventi tardivi non ricreano una scheda chiusa. Immagini vuote rifiutate.
- Git: `%(worktreepath)` identifica i branch già in uso. Menu di cambio e cancellazione li mostrano disabilitati con
  **In worktree** e percorso nel tooltip; main rifiuta anche le chiamate dirette, inclusa la cancellazione forzata.
  Il branch corrente resta utilizzabile; riaprire il menu aggiorna la disponibilità quando un branch viene liberato.
- Verifica finale: **typecheck, lint e build passano; 47 file di test, 669/669 test passano** con timeout temporanei estesi.
  Comando: `npm.cmd test -- --testTimeout 120000 --hookTimeout 120000`. Nessuna modifica alla configurazione dei timeout.
- Prova Git nell'app dev superata su repository temporaneo: cambio normale, branch occupato, cancellazione anche forzata,
  rilascio del branch e aggiornamento del menu.
- Prova browser nell'app dev superata con immagini ottenute via CDP nel solo driver: invio con URL originale e PNG non
  vuoto dopo navigazione; resize e commento conservato; Esc durante cattura ritardata; doppio avvio; cattura vuota e retry.
  Dopo il fix, nessun avviso di loop di `ResizeObserver` nella prova.
- **Limite della verifica:** la cattura nativa Windows resta intermittente nell'ambiente di automazione; non è stata
  corretta né sostituita nel prodotto. Mancano ancora tastiera fisica e scala Windows 125–150%. Nessun test live eseguito.
- `AGENTS.md` era già non tracciato all'inizio: è stato seguito ma resta locale, fuori dal commit. Gli altri file nuovi
  sono i due test e questo handoff. I driver e i profili di prova restano in `.tmp/`, ignorata da Git.

## Cosa abbiamo provato che NON ha funzionato

- `npm` in PowerShell sceglie `npm.ps1`, bloccato dalla execution policy. Usare **`npm.cmd`**; non cambiare la policy.
- La suite con timeout standard fallisce su operazioni lente di Git e sul test che crea 5.001 file. Nel sandbox compaiono
  anche errori EPERM e accesso negato alla configurazione globale Git. Fuori dal sandbox, con timeout test/hook di 120 s,
  la suite passa. Non allargare i timeout nel repository e non attribuire questi fallimenti alle nuove funzioni.
- Le porte CDP `9333` erano occupate da un'altra istanza. Non chiuderla: per le nostre prove abbiamo usato **9443**
  per il renderer e **9449** per main.
- `capturePage()` può restituire `UnknownVizError` o restare in attesa. Una finestra minimizzata è stata osservata con
  content bounds nulli; restore/focus e `stayAwake: true` non hanno reso tutte le prove affidabili.
  Non confondere la successiva verifica con CDP con una verifica della cattura nativa.
- Un repo temporaneo creato dall'account del sandbox e aperto da Electron con l'account utente provoca **dubious ownership**.
  Ricreare setup e driver Git con lo stesso account dell'app. Non aggiungere eccezioni globali `safe.directory`.
- Nel driver Vite, il modulo si importa da `/browser/browser-store.ts`, non da `/src/renderer/browser/browser-store.ts`.
  `Runtime.evaluate` non accetta top-level `await`: usare una Promise o una funzione async.
- Un selettore generico `title*=browser` cliccava il progetto chiamato Browser polish; usare `button[aria-label="Browser"]`.

## Problemi incontrati e come li abbiamo risolti

- URL corrente e bounds correnti potevano essere abbinati a un'immagine più vecchia: ora tutti i metadati appartengono
  alla cattura e il suo ID viene controllato al pick. Un contatore distingue anche i reload allo stesso indirizzo.
- Una risposta asincrona poteva riaprire una selezione annullata: il renderer tiene un token per richiesta e lo invalida
  su Esc, errore e chiusura; prima di applicare il risultato controlla che sia ancora quello corrente.
- Togliere la barra di errore prima di un retry cambia i bounds: si attendono due animation frame prima della cattura,
  ricontrollando poi il token. I test coprono anche l'annullamento durante questa attesa.
- Cancellare la selezione dentro il callback di resize produceva `ResizeObserver loop completed with undelivered
  notifications`: annullamento via `requestAnimationFrame`, con cleanup. Prova nell'app ripetuta senza l'avviso.
- Nel primo test Git nuovo era stato usato un nome di helper inesistente; è stato corretto in `addWorktree` e la suite
  finale è stata rieseguita interamente. Non ci sono fallimenti di test lasciati aperti.

## Decisioni prese

- **Annullare al resize e conservare il testo**, anziché rimappare una selezione su un'immagine stirata: meno codice e
  nessun ritaglio apparentemente valido ma spostato. README aggiornato per spiegare il comportamento.
- **Identità della cattura nel contratto IPC**, anziché assumere che l'ultima immagine sia sempre quella visualizzata:
  una cattura concorrente o di un overlay non può fornire il ritaglio di un'altra immagine.
- **Omettere i metadati dell'elemento dopo navigazione/layout cambiato**, anziché descrivere una pagina diversa dal PNG.
- **Guardia Git anche in main**, anziché limitarsi alle voci disabilitate: messaggio leggibile anche con menu superato
  o chiamata diretta. Git resta la protezione finale contro una modifica concorrente esterna.
- **CDP solo nel driver di verifica**, anziché alterare la cattura di produzione per aggirare un problema dell'ambiente.
- Nessuna nuova dipendenza, nessun cambiamento all'isolamento degli agenti o alle protezioni della sessione browser.

## File toccati

- `src/main/services/browser/views.ts`: metadati/ID della cattura, bounds e zoom congelati, rifiuto delle immagini vuote,
  controllo delle navigazioni e descrizione dell'elemento, pulizia dell'avviso di redirect.
- `src/shared/browser.ts`: tipo `BrowserCapture`.
- `src/shared/types.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`: contratto capture/pick allineato.
- `src/renderer/browser/browser-store.ts`: ciclo di vita delle catture, cancellazione e risposte tardive, URL catturato
  nel messaggio, retry dopo errore, eventi dopo la chiusura ignorati.
- `src/renderer/components/BrowserPane.tsx`: suggerimento fuori dall'immagine, stato Capturing, Esc durante l'attesa,
  lettura del nuovo risultato capture anche per gli overlay.
- `src/renderer/components/BrowserSelect.tsx`: focus dopo ogni drag, annullamento su resize con cleanup del frame.
- `src/shared/git.ts`: campo worktree dei branch, `REFS_FORMAT` e parser con supporto CRLF.
- `src/main/services/git/repo.ts`: rifiuto leggibile di switch/delete dei branch occupati.
- `src/renderer/components/GitSections.tsx`: voci occupate disabilitate, etichetta e tooltip.
- `tests/main/browser-views.test.ts`: nuovo; metadati, crop, ID, catture vuote e cambi durante una cattura.
- `tests/renderer/browser-store.test.ts`: nuovo; URL al send, richieste concorrenti/tardive, errori, chiusura e retry.
- `tests/main/git.test.ts`, `tests/shared/git.test.ts`: percorso worktree, parser e blocco delle operazioni sui branch occupati.
- `README.md`: URL catturato e comportamento al resize.
- Questo handoff, sequenza 10 della catena.

## Dove vogliamo andare

1. **Rivedi il branch `polish/browser-git-2026-11-09` rispetto a `main`.** Le modifiche sono pronte per review; il push
   non autorizza un merge automatico. Verifica lo stato effettivo del remoto prima di unire o aprire una PR.
2. **Completa la prova manuale del browser senza override del driver:** Ctrl+` con pagina a fuoco e scrittura nel
   terminale; Ctrl+Shift+S ed Esc; Ctrl+R che ricarica solo la pagina lasciando vivi i terminali; invio di un ritaglio
   con scala Windows 125–150%. Riproduci la cattura nativa nell'uso reale prima di decidere se intervenire su `UnknownVizError`.
3. **Concorda poi la prossima priorità con l'utente.** Le fasi numerate di `PROJECT.md` sono terminate; non è stata scelta
   una nuova milestone. Restano Minor del vecchio handoff, tra cui altezza stimata del commento, `pointercancel`,
   timer/subscribe, casi limite di `describe.ts`, focus se open fallisce e altri dettagli Git. Non riproporre quelli risolti qui.

## Da sapere prima di toccare qualcosa

- Rileggi `AGENTv2.md` e le istruzioni di progetto. Non scrivere in `~/.claude`, `~/.codex` o nel profilo reale `%APPDATA%/ark`.
- I test reali `npm.cmd run test:live` consumano token: chiedere prima. In questa sessione nessun agente è stato avviato
  dai thread finti: `phase: 'done'`, `status: 'idle'` permette il salvataggio dei messaggi senza chiamare modelli.
- Le istanze Electron di prova sono state chiuse. Prima di terminare un processo verificarne il profilo `*ark-profile*`;
  non terminare Electron o Node in blocco.
- Driver locali: `.tmp/git-branch-polish.cjs`, `.tmp/browser-polish.cjs` (setup), `.tmp/browser-snapshot-check.cjs`,
  `.tmp/cdp-query.cjs`. Sono intermedi ignorati, non una dipendenza del progetto o del prossimo checkout.
- Il driver browser finale usa temporaneamente `webContents.debugger` con `Page.captureScreenshot` e converte il PNG
  in `nativeImage` per alimentare il vero flusso capture/pick/send. Simula anche ritardo e immagine vuota. Il codice
  di produzione continua a chiamare `webContents.capturePage()` senza questi override.
- Se si cambia il contratto browser, aggiornare insieme main, preload, tipi, store e overlay; un vecchio renderer non
  passa il nuovo capture ID. Riavviare la prova per usare anche il nuovo preload.
- Commit con `git commit -F` e un file UTF-8 senza BOM. Non includere `.tmp/`, profili, build o `AGENTS.md` preesistente.
