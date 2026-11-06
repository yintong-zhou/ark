---
type: handoff
date: 2026-11-05
status: pronto per la prova manuale (nulla è committato)
seq: 1
prev: nessuno (il lavoro precedente è la catena `ark-phase1-step2`, ultimo file `docs/handoff/2026-11-05-ark-phase1-step2-done.md`, già mergiato con la PR #4)
tags: [ark, electron, ui, brand, chat, allegati, tag, emoji, usage]
---

# Handoff — Ark: grafica rifatta, chat con allegati e tag, barra utilizzo

## Obiettivo

Ark unisce la struttura canale/thread di Slack e Discord con l'orchestrazione degli agenti. La grafica doveva seguire `brand-guidelines.md` (scuro, minimale, conversazionale) in modo che "tocca a te" si legga a colpo d'occhio. In tre richieste di fila si è chiesto:

1. rifare tutta la UI sullo scheletro a quattro colonne delle guidelines;
2. rendere la chat più minimale e aggiungere file, immagini, emoji, `@` per gli agenti e `#` per le etichette del thread, usando emoji al posto del testo dove chiarisce;
3. aggiungere i logo di Claude e OpenAI e rifare la zona dell'utilizzo come nello screenshot dell'utente (barra, due letture, tasto di aggiornamento).

## A che punto siamo

- **Branch `main`, HEAD `a812afa`, nulla committato.** `git status --short` dà 60 righe tra file modificati e nuovi. Vale ancora la regola della sessione precedente: si committa solo quando lo chiede l'utente.
- **Verde:** `npm run lint`, `npm run typecheck`, `npm test` (283/283, erano 269), `npm run build`.
- **Visto dal vivo:** ogni schermata, sulla build (non in dev) con un profilo di prova e un client CDP; la finestra reale con la barra del titolo senza cornice; il minimo di 960×600. Con la IPC vera: lo `.zip` viene rifiutato, un messaggio con immagine, file, tag e menzione si salva e il tag compare nella sidebar.
- **Mai provato con agenti veri (consuma crediti, tocca all'utente):**
  - un'immagine allegata arriva davvero a Claude (blocco `image` base64 nel JSON di stream) e a Codex (voce `image` con data URL in `turn/start`). Lo schema di Codex la ammette, ma non è stata provata. I test coprono solo i processi finti;
  - Add project, Initialize Git, Approve team, Start developer, chiusura durante un turno, seconda istanza, Ctrl+R: restano gli stessi punti non provati del handoff precedente;
  - `npm run dev` non è mai stato lanciato in questa sessione.
- **Funziona e verificato:** rail con progetti e barra "tocca a te", sidebar per area, thread con gruppi di messaggi, reazioni, card con linea a gomito, composer a una riga, suggerimenti `@` e `#`, griglia di 40 emoji, allegati in attesa con anteprima, tag sul thread con filtro nella sidebar, logo nella barra e nelle etichette del modello.

## Cosa abbiamo provato che NON ha funzionato

- **Script lunghi in heredoc da Bash.** Vanno in `unexpected EOF` oltre le ~80 righe, e i backslash vengono mangiati: `\w` è diventato `w` in `store.ts` e `o\d` è diventato `od` in `Logos.tsx`. Sono bug veri, trovati da un test e da una grep. → Scrivere gli script con lo strumento Write in `scratchpad/*.cjs` e lanciarli con `node`; le regex si correggono con Edit, poi si controlla con grep.
- **Sostituzioni multi-riga sui file del repo.** I sorgenti sono CRLF: il pattern con `\n` non combacia. → Normalizzare `\r\n` → `\n`, sostituire, riscrivere con lo stesso fine riga.
- **`location.reload()` via CDP.** La pagina restava sul bundle vecchio, e si è letto uno screenshot "corretto" per la finestra più larga. → `Page.reload` con `ignoreCache`, e controllare l'hash dello script caricato.
- **Comporre `FIELD` e `INPUT` con `py-1` e `py-0`.** Vince `py-1` e i select restavano tagliati. → Una base senza padding verticale e due varianti.
- **Barra "tocca a te" nella rail.** La lista con `overflow-y-auto` si restringeva a 40px e tagliava la barra di 2px a sinistra. → `w-full` sulla lista.
- **Griglia emoji `absolute` con `grid-cols-8`.** Collassava a 32px (colonne `minmax(0,1fr)`). → Larghezza esplicita `w-[288px]`.
- **Regole globali non in un layer.** Battevano le utility di Tailwind (il font di `h3`, l'outline). → Tutto in `@layer base`.
- **Avatar `bg-raised` dentro una card Raised.** Spariva. → Prop `inset` (sfondo Primary).
- **Pillola "tocca a te" sulla riga selezionata.** Raised su Raised, invisibile. → `group-aria-[current=page]:bg-primary`.
- **Titolo dell'header con `shrink-0`.** Schiacciava lo stato del thread. → Il titolo si tronca per primo.
- **`let prev` riassegnata nel render** per raggruppare i messaggi: lo blocca `react-hooks/immutability`. → `shown.map((m, i) => startsGroup(shown[i - 1], m))`.
- **Test del conductor con un messaggio durante un turno.** Servono due risposte in coda, altrimenti il secondo turno resta appeso ("a loop is still running").
- **Logo OpenAI da Simple Icons.** Non c'è più nella v16. → Preso da Lobe Icons (MIT); Claude da Simple Icons (CC0).

## Problemi incontrati e come li abbiamo risolti

- **Un tag scritto durante un turno spariva.** Il turno salva la sua copia vecchia del thread. → `Conductor.save` rilegge i tag da disco prima di salvare. Test: "a tag written during a turn is not lost when the turn saves".
- **Nome di un allegato come percorso.** → `store.saveFile` lo ripulisce e lo prefissa con 8 cifre esadecimali; `readFile` accetta solo `^[0-9a-f]{8}-[\w.-]{1,120}$`. Test con `../thread.json`, `a/b`, ecc.
- **Messaggio fatto solo di file.** `messageText` rifiutava il testo vuoto. → In IPC il testo può essere `''` solo se ci sono file.

## Decisioni prese

Con il costo se fossero sbagliate, e l'alternativa scartata.

1. **All'avvio si apre il workspace dei thread, non più Usage.** Scartato: restare su Usage. Una riga in `App.tsx`.
2. **Rail = progetti + Usage e Agents in basso; la sidebar cambia con l'area.** Scartato: una sidebar con l'albero di tutti i progetti.
3. **Barra del titolo di 32px in Primary con `titleBarOverlay`.** Scartato: cambiare il colore dell'overlay per ogni colonna (serve IPC) e pulsanti disegnati a mano (serve IPC e logica di finestra).
4. **Intestazioni di sezione in minuscole normali** (12px, 0.04em, mute), non in maiuscolo. Le guidelines dicono "small caps style".
5. **"Your turn" al posto di "waiting for you"**, e nella sidebar solo ✋ con il testo nel tooltip.
6. **Tag = etichette del thread** (scelta dell'utente, tra etichette, skill del catalogo e altri thread). Stanno in `Thread.tags`, si accumulano dai `#tag` dei messaggi dell'utente, massimo 12. Scartato: derivarli dai messaggi (la sidebar non li avrebbe senza aprire ogni thread). Non esiste il modo di toglierne uno.
7. **Allegati:** le immagini vanno all'agente come immagini, i file di testo si incollano nel messaggio, il resto è rifiutato. Il tipo si decide dall'estensione. Scartato: passare un percorso e dare all'agente `--add-dir` (romperebbe l'isolamento), i PDF, `.env`.
8. **Upload dalla UI con `File.arrayBuffer()` via IPC**, non con un dialog nativo e percorsi. Così il renderer non vede mai percorsi del disco e incolla e trascinamento funzionano allo stesso modo.
9. **`runner.turn(..., images)` con `images` come ultimo parametro posizionale** (si chiama con due `undefined`). Scartato: un oggetto di opzioni, che cambiava tutti i chiamanti e i test.
10. **Il Claude resta arancione (#D97757)**, come nello screenshot dell'utente: è l'unica tinta fuori palette. L'utente ha chiesto i logo, e la sua istruzione batte le guidelines.
11. **La barra in basso è diventata la zona utilizzo** ("Used", logo, barra delle 5 ore, due letture, ↻). Il tasto Refresh della pagina Usage resta.
12. **Emoji: 40 fissi, senza ricerca né categorie. Le reazioni restano 👍 e 👎** (la IPC le valida così e gli agenti le leggono).
13. **La chat diretta con un agente non ha allegati né tag**, solo le emoji. Usage e Agents hanno le emoji solo nei logo.
14. **Un tag non risponde a `#12`** (deve iniziare con una lettera): evita di prendere i riferimenti alle issue.

## File toccati

- **Main e shared**
  - `src/main/index.ts`: finestra senza cornice, overlay 32px.
  - `src/main/ipc/index.ts`: `uploads()`, `threads:send` e `threads:create` con file, `threads:attachment`.
  - `src/main/services/threads/conductor.ts`: file e tag in `create` e `send`, `userMessage`, `save` che rilegge i tag, in `run` testo inline e immagini.
  - `src/main/services/threads/protocol.ts`: `formatForAgent` descrive gli allegati.
  - `src/main/services/threads/store.ts`: `saveFile`, `readFile`.
  - `src/main/services/engines/{session,claude-session,codex-session}.ts` e `agent-runner.ts`: parametro `images`.
  - `src/preload/index.ts`.
  - `src/shared/attachments.ts` (nuovo), `src/shared/tokens.ts` (nuovo: `tokenize`, `mergeTags`, `activeToken`), `thread.ts` (`tags`, `attachments`), `types.ts`, `thread-view.ts` (`startsGroup`).
- **Renderer, nuovi:** `components/{Avatar,Icons,Logos,Rail,Shell,Sidebars,Cards,Composer,EmojiPicker,Attachments,TokenLine,ui,glyphs}`, `assets/logo.png`.
- **Renderer, riscritti:** `index.css` (token del brand, tema Tailwind ripulito), `App.tsx`, `agents.ts`, `components/{Page,StatusBar,TeamPanel,ThreadView,AgentTag,Bar,WindowCell}`, tutte le `pages/*`, `hooks/useThreads.ts` (`addProject` restituisce il progetto, `create` accetta i file).
- **Rimosso:** `components/WindowText.tsx`.
- **Test:** nuovo `tests/shared/tokens.test.ts`; aggiunte in `thread-view`, `thread-store`, `thread-protocol`, `conductor`, `claude-session`, `codex-session`.
- **`README.md`:** mentions, tag, file, emoji, "Your turn".

## Dove vogliamo andare

1. **Prova manuale con agenti veri** (tocca all'utente, consuma crediti; circa 15 minuti). Lancia `npm run dev`, apri un thread di prova in un repo di prova e:
   1. allega un PNG a un messaggio durante la fase di planning e chiedi che cosa mostra; fallo con un agente su Claude e con uno su Codex;
   2. allega un file `.md` e verifica che l'agente lo citi;
   3. scrivi `#bug` e controlla chip, sidebar e filtro; scrivi `@planner` e controlla che parli il planner;
   4. incolla uno screenshot (Ctrl+V) e trascina un file sul composer;
   5. ripeti i punti non provati del handoff precedente (Add project, Initialize Git, Approve team, Start developer, chiusura durante un turno, seconda istanza, Ctrl+R, nessun `claude`/`codex` orfano dopo l'uscita).
2. **Se passa: branch e PR.** Crea `ui-chat-redo`, committa con `git commit -F <file>` (vedi sotto), poi `gh pr create --body-file`. Il working tree mescola le tre richieste negli stessi file (`ThreadView`, `Composer`, `Shell`): un solo commit è realistico, dividere per richiesta no.
3. **Dopo il merge:** il passo 3 della Fase 1 (build nel worktree). Porta con te i "minor deferred" del handoff `2026-11-05-ark-phase1-step2-done.md`, che valgono ancora.

## Da sapere prima di toccare qualcosa

- **Mai toccare `%APPDATA%\ark`.** Ci sono progetti veri (hourworth, TEST) e un thread vero. Per provare usa un profilo a parte: `npm run build`, poi `node_modules/.bin/electron . --user-data-dir=<cartella> --remote-debugging-port=9333` con `ELECTRON_RENDERER_URL` vuoto. Node 24 ha `WebSocket` globale, basta per parlare in CDP e fare `Page.captureScreenshot` (non cattura i pulsanti nativi della finestra: per quelli, copia lo schermo).
- **Dati finti:** `projects.json` e `threads/<uuid>/{thread.json,messages.jsonl}` nel profilo. La lettura di Claude si finge con un JSON da `tests/fixtures/claude-statusline.json` in `<profilo>/claude/sessions/` con `resets_at` nel futuro, in secondi. Gli script usati stavano nella cartella scratchpad della sessione e vanno riscritti.
- **Mandare un messaggio a un thread in fase `team` o `planning` lancia un agente vero, a pagamento.** In fase `build` o `done` il messaggio si salva e non parte nessun turno: è il modo sicuro per provare la IPC con i file.
- **Il tema Tailwind è ripulito:** esistono solo i colori, i raggi e le dimensioni del brand (`text-meta`, `text-body`, `text-title`, `rounded-xs` 2px, `rounded-sm` 4px, spaziatura da 8px). `text-sm` e `rounded` non esistono. Il peso del testo è 400 e quello dei titoli 600: sono gli unici caricati.
- **Le guidelines valgono, ma l'istruzione dell'utente le batte** (emoji dove chiarisce, logo di Claude arancione). Il Claude arancione è un'eccezione dichiarata, non un precedente per altre tinte.
- **Fine riga:** il repo è CRLF, molti file nuovi sono LF; Git avvisa dell'autocrlf e normalizza da solo.
- **Messaggio di commit sempre da file** (`git commit -F`): in PowerShell 5.1 gli here-string con le virgolette si spezzano. Attribuzione: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- **Il banner "Claude Code sessions aren't reported yet"** dipende dalle impostazioni vere dell'utente, non dal profilo di prova.
- **I marchi** Claude e OpenAI restano di Anthropic e OpenAI; i tracciati in `Logos.tsx` sono approssimazioni da set aperti. Se arrivano i file ufficiali, si sostituiscono le due costanti.
