---
type: handoff
date: 2026-11-08
status: Fase 4 completa sul branch phase4-browser (pushato, non unito in main)
seq: 9
prev: docs/handoff/2026-11-08-ark-phase3-done.md
tags: [ark, electron, phase4, browser, webcontentsview, done]
---

# Handoff - Ark Fase 4 (browser integrato con selezione di un'area) completa

## Obiettivo

Ark mette Claude Code, Codex e OpenCode in un'unica app desktop. La Fase 4 serve a mandare al thread un problema visivo senza screenshot e incolla:
1. l'utente avvia il dev server nel terminale di Ark e apre il browser in una scheda;
2. seleziona la zona sbagliata e scrive un commento;
3. il commento arriva come suo messaggio nel thread aperto, con il ritaglio allegato e una riga che nomina la pagina e l'elemento.

## A che punto siamo

- **Il branch è completo e pushato.** È `phase4-browser`, 10 commit da `main` (`2de901c..ed8bc52`). Non è unito in `main`. Sul remoto c'è solo il branch, nessuna PR.
- **Spec e piano sono già in `main`:**
  - `docs/superpowers/specs/2026-11-08-phase4-browser-design.md`
  - `docs/superpowers/plans/2026-11-08-phase4-browser.md`
- **Controlli:** typecheck e lint puliti, `npm test` 645/645, build ok.
- **Processo:** 7 task con subagent-driven development, ognuno con la sua review. Due giri di fix, nei task 4 e 6, entrambi sul bordo frazionario della selezione. Review finale su Opus: "with fixes", 4 correzioni fatte e riverificate.
- **Prova CDP nell'app costruita: tutto passa.** Coperto:
  - navigazione e rifiuto di `example.com`;
  - link esterno aperto fuori, redirect, `location =` e `window.open` bloccati;
  - la pagina non vede `window.ark`, `require` né `process`;
  - seleziona, commenta e invia: testo, riga `Element:`, PNG, e il `#ui` dell'utente sì ma il `#sale` della pagina no;
  - nessun thread aperto;
  - cambio di thread e di progetto;
  - Usage, resize, terminale e divisore;
  - menu sopra la pagina;
  - ricarica di Ark;
  - server spento più Retry;
  - zoom di Ark 1.25 con ritaglio esatto;
  - focus della tastiera dopo Ctrl+` e Ctrl+Shift+S mandati dalla pagina;
  - drag al bordo su tutta la larghezza.
- **Mai provato a mano:**
  - la scala di Windows al 125–150% (verificato solo lo zoom di Ark);
  - i tasti veri da tastiera fisica (vedi sotto).
- **Working tree:** pulito, tranne `vitest.config.mts` con uno spazio in più a inizio file. Non è nostro, c'era già, non va committato. Chiedi all'utente se va scartato.

## Cosa abbiamo provato che NON ha funzionato

- **`WScript.Shell.SendKeys` per provare Ctrl+R nella pagina.** I tasti finiscono in un'altra finestra in primo piano, per via del foreground lock di Windows, anche con `win.focus()`. Usa `webContents.sendInputEvent` dal processo main: fa scattare `before-input-event`. Attenzione però, non dimostra dove sia il focus reale del sistema operativo.
- **CDP `Input.dispatchKeyEvent` sul target della pagina per Ctrl+R.** Non passa da `before-input-event` né dal menu, quindi il test non prova niente.
- **CDP `Input.dispatchMouseEvent` col tasto destro per aprire il menu del FileTree.** Il menu non si apriva. Usa un `contextmenu` sintetico con `dispatchEvent`.
- **Screenshot CDP (`Page.captureScreenshot`) di Ark.** Non include la `WebContentsView` nativa: la pagina risulta vuota. Il ritaglio si controlla dal PNG allegato al messaggio.
- **Arrotondare i bounds della vista prima di salvarli** (prima versione del task 4). Le selezioni fino al bordo venivano rifiutate. Ora `viewBounds` tiene `css` non arrotondato e arrotonda solo `dip`.
- **Misurare il riquadro con `clientWidth`/`clientHeight`** (task 6). Sono interi arrotondati al più vicino: 800.6 diventa 801 e la selezione al bordo esce dai bounds. Ora c'è `getBoundingClientRect()` più `clampPoint`.
- **Controllo esatto `x + width <= W`.** In virgola mobile `x + (W - x)` può superare W, per esempio `800.4000000000001`. Ora c'è una tolleranza di 0.5 in `cleanRect`.
- **Riconoscere Ctrl+R/W da `input.key`.** Su layout non latini la lettera è `к` o `ц`, mentre il menu predefinito agisce sul tasto virtuale: Ark si ricaricava o si chiudeva. Ora `keyAction` usa `input.code`.
- **Inoltrare Ctrl+` dalla pagina senza spostare il focus.** Il terminale si apriva, ma si continuava a scrivere nella pagina. Ora c'è `win.webContents.focus()` prima dell'inoltro.

## Problemi incontrati e come li abbiamo risolti

- **Il piano diceva "#id e smetti di salire"**, ma il suo test voleva `main>section.grid>#plan-pro`. Regola presa:
  - l'id dell'elemento stesso non ferma la salita;
  - l'id di un antenato la ferma;
  - `body` non entra mai nel percorso;
  - al massimo 5 livelli, tenendo i più vicini.
- **Il task 5 non poteva chiamare `startSelect`**, che nasce nel task 6. Il collegamento di Ctrl+Shift+S e del tasto `select` è passato al task 6.
- **Electron 45 non ha un flag "gesto dell'utente"** sulla navigazione. "Avviata dall'utente" vuol dire un input (`mouseDown`, `keyDown` o `rawKeyDown`) nell'ultimo secondo. Dopo un'apertura esterna il gesto è consumato: un clic, una scheda sola.

## Decisioni prese

- **Scelte dell'utente:**
  - il browser è una scheda accanto al thread e ai file (scartato: affiancato al thread);
  - si selezionano solo rettangoli (scartato: hover più clic sull'elemento);
  - solo indirizzi locali (scartati: i siti esterni);
  - il server lo avvia l'utente (scartato: Ark che lo trova o lo avvia);
  - l'agente riceve sia l'immagine sia l'elemento.
- **Scelte mie, nella spec come [call]:**
  - `WebContentsView` (scartato: `<webview>`);
  - fermo immagine durante la selezione (scartato: script nella pagina viva);
  - sessione `persist:ark-browser`;
  - certificati self-signed accettati solo per host locali;
  - risorse remote caricate dalla pagina permesse;
  - iframe non locali bloccati (non aperti fuori);
  - redirect automatici bloccati con barra;
  - Ctrl+R e F5 ricaricano la pagina, Ctrl+W ingoiato;
  - neutralizzazione di `#` e `@` nel testo della pagina con U+2060 (scartato: un canale separato in `threads:send`).
- **Ruling dell'esecuzione:**
  - Ctrl+Shift+S collegato nel task 6;
  - la regola sul percorso CSS descritta sopra;
  - task 1 e 2 a un solo implementatore.
- **Deviazioni accettate dal task 4:**
  - `pickRect = rect * arkZoom / viewZoom` (il piano era sbagliato);
  - anche Ctrl+Shift+R ricarica la vista;
  - `will-navigate` e `will-redirect` solo sul main frame;
  - timeout di 2 s sulla descrizione dell'elemento.

### Minor rimandati

La review finale li ha giudicati tutti "possono aspettare". I più visibili prima:

- la barra "Drag over the area…" copre i primi ~24 px della pagina durante la selezione;
- la barra dei redirect bloccati non sparisce dopo una navigazione locale: va pulita su `did-navigate`;
- dopo un secondo drag il focus non torna nel campo del commento;
- se la pagina fallisce durante la selezione, `sel` resta e Esc non annulla: `cancelSelect` quando `!live`;
- l'URL del messaggio è preso all'invio, non alla cattura;
- capture e bounds possono venire da layout diversi se si ridimensiona durante il fermo immagine;
- una cattura vuota produce un PNG da 0 byte;
- l'altezza del riquadro del commento è stimata a 170 px;
- doppio `startSelect` prima che la cattura risponda;
- manca il reset su `pointercancel`;
- un loop di navigazione non locale inonda `browser:state`;
- `loadURL` riceve la stringa grezza invece di `new URL(url).href`;
- il timer del timeout di describe non viene cancellato;
- un `subscribe` inline in `useBrowser`/`useOverlayOpen` (da portare a livello di modulo);
- `onState` dopo la chiusura ricrea la voce nello store;
- la scheda prende il focus anche se `browser.open` fallisce;
- `useOverlay` gira in `useEffect` (meglio `useLayoutEffect`);
- il timer di "Sent" non viene cancellato al secondo invio;
- un listener Esc globale scatta anche durante l'IME;
- in `describe.ts`:
  - `document.body` null;
  - `<input name="id">` dentro un form;
  - id non escapati;
- `isLocalHost` accetta ottetti oltre 255 (irraggiungibile via URL);
- mancano test per il punto finale e per `"#…`;
- il carattere U+2060 è scritto letterale nel sorgente.

## File toccati

- `src/shared/browser.ts`: nuovo. Contiene tutte le regole pure:
  - `isLocalHost`, `isLocalUrl`, `toAddress`, `navVerdict`, `certVerdict`, `keyAction`;
  - `neutralize`, `cleanElement`, `browserMessage`;
  - `cleanRect`, `cleanBounds`, `viewBounds`, `imageBox`, `clampPoint`, `boxPlace`, `areaName`;
  - i tipi `BrowserState`, `Picked`, `ElementInfo`.
- `src/main/services/browser/session.ts`: nuovo. `lockDown` sulla partizione (permessi, download, certificati, filtro `onBeforeRequest`).
- `src/main/services/browser/describe.ts`: nuovo. Lo script nella pagina (`pageDescribe`, `describeScript`).
- `src/main/services/browser/views.ts`: nuovo. `BrowserViews`: viste per progetto, politica di navigazione, tasti, cattura e pick.
- `src/main/ipc/index.ts`: 11 canali `browser:*`; `destroyAll` alla ricarica di Ark.
- `src/preload/index.ts`, `src/shared/types.ts`: `ArkApi.browser`.
- `src/renderer/browser/browser-store.ts`, `src/renderer/browser/overlay.ts`: nuovi.
- `src/renderer/components/BrowserPane.tsx`, `src/renderer/components/BrowserSelect.tsx`: nuovi.
- `src/renderer/editor/tabs-store.ts`: `BROWSER_TAB`, `keys` in `TabsView`, `focusBrowserTab`/`dropBrowserTab`.
- `src/renderer/components/TabStrip.tsx`: la scheda browser e il pulsante globo.
- `src/renderer/components/Icons.tsx`: `GlobeIcon`.
- `src/renderer/components/Menu.tsx`, `src/renderer/components/GitSections.tsx`: `useOverlay()`.
- `src/renderer/pages/Threads.tsx`: il pannello del browser, TeamPanel solo sulla scheda del thread, Ctrl+Shift+S, `onBrowserKey`.
- Test: `tests/shared/browser.test.ts`, `tests/main/browser-message.test.ts`, `tests/main/browser-describe.test.ts`, `tests/main/browser-session.test.ts`.
- `README.md`: la sezione `## Browser`.

## Dove vogliamo andare

1. **Fai una prova a mano** nell'app (`npm run dev`), con la tastiera vera:
   - premi Ctrl+` con la pagina a fuoco e scrivi: il testo va nel terminale;
   - premi Ctrl+Shift+S, poi Esc;
   - premi Ctrl+R nella pagina: si ricarica solo la pagina e i terminali restano vivi;
   - se puoi, ripeti con la scala di Windows al 150% e guarda il ritaglio.
2. **Chiedi all'utente se unire `phase4-browser` in `main`.** La volta scorsa si è fatto un fast-forward più push. Può anche preferire una PR (`gh pr create`).
3. **Poi la prossima milestone.** `PROJECT.md` ha finito le fasi numerate. Restano le "Extra features", ancora da collocare. Facoltativi:
   - un passo di rifinitura con i Minor sopra (barra in alto e barra dei redirect sono i più utili);
   - quelli Git della Fase 3 (`%(worktreepath)` nel menu dei branch).

## Da sapere prima di toccare qualcosa

- **Restano le regole di sempre:**
  - mai scrivere in `~/.claude`, `~/.codex` o `%APPDATA%\ark`;
  - commit con `git commit -F` e un file senza BOM;
  - `npm run test:live` costa token: chiedi prima;
  - chiudi l'electron di prova filtrando `*ark-profile*` in `Win32_Process`.
- **Ricetta CDP della Fase 4.** I driver erano nello scratchpad e non sopravvivono.
  - **Avvio:** `npm run build`, poi `ELECTRON_RENDERER_URL=''` e `electron.exe . --user-data-dir=<scratch>\ark-profile-… --remote-debugging-port=9333 --inspect=9339`.
  - **Processo main:** con `--inspect=9339` si valuta codice nel main via `http://127.0.0.1:9339/json/list`. Dentro, `process.mainModule.require('electron')` dà `BrowserWindow`, `contentView.children`, `webContents.isFocused()` e permette di stubbare `shell.openExternal`.
  - **Vista del browser:** appare come target CDP su 9333, con l'URL della pagina.
  - **Coordinate:** l'input CDP verso Ark è in CSS px di Ark. A zoom Z le coordinate della vista sono `bounds DIP / Z`.
  - **Thread finti senza token:** `thread.json` con `phase: 'done'` e `status: 'idle'`. Un messaggio lì viene salvato senza svegliare agenti.
- **La `WebContentsView` sta sopra il renderer.** Ogni nuovo popup di Ark che può coprire la pagina deve chiamare `useOverlay()`, altrimenti finisce sotto la pagina.
- **La pagina è contenuto non fidato.** Ogni stringa che ne esce passa da `cleanElement` e `neutralize`. La difesa vera contro una pagina non locale è il filtro `onBeforeRequest` della sessione: non toglierlo.
- **I subagenti firmano `Claude Sonnet 5.5`** nel trailer quando girano su Sonnet. È corretto.
