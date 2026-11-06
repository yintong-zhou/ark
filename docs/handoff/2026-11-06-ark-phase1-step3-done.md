---
type: handoff
date: 2026-11-06
status: fatto (passo 3 su main, restano due follow-up e la prova manuale)
seq: 2
prev: docs/handoff/2026-11-06-ark-phase1-step3.md
tags: [ark, electron, phase1, step3, build, worktree, approvals, done]
---

# Handoff — Ark Fase 1, passo 3 (fasi di build), completato

## A che punto siamo

- **Branch.** `phase1-step3-build-phases` è stato unito su `main` in fast-forward (`c1b0746..a6a6864`). Non è pushato, e il branch locale è cancellato.
- **Controlli.** Su `a6a6864` passano typecheck, lint e `npm test` (380/380).
- **Cosa è entrato:**
  - worktree Git su `ark/…`;
  - ciclo per fase: sviluppo → check → code review → security review, con escalation al PM dopo 2 giri;
  - card Allow/Deny su Claude e Codex;
  - IPC `threads:answer`;
  - `PhaseCard`, `ApprovalCard` e badge `needsYou`;
  - test live in `tests/live/build.live.test.ts`;
  - README, sezione Threads.
- **Correzioni dopo la review finale:**
  - I1: i check girano senza card, grazie a regole `allow` esatte per gli script di check e `npm test`;
  - I2: il Git di Ark non lancia gli hook del progetto (`-c core.hooksPath` su un percorso che non può esistere);
  - I3: la build si rifiuta di partire se `.claude/settings.json` del worktree ha `permissions.allow`, `permissions.defaultMode` o `hooks`, e anche se il file non è JSON valido;
  - I4: un messaggio dell'utente scritto durante la build arriva al developer al suo turno successivo, come "The user replied";
  - M1: il worktree si crea solo dalla radice del repo;
  - M2: i sotto-titoli numerati non diventano fasi;
  - M3: un check scaduto è etichettato "timed out";
  - M7: README.
- **Confermato dal vivo (Claude, tier light):**
  - la forma di `allow` funziona;
  - `contextUsed` arriva su uno stream vero;
  - con `--tools Read,Glob,Grep,Skill` le skill si caricano ancora.

## Rulings prese durante il lavoro

Tutte, in ordine.

- **R1:** un `plan` senza `## Phase N:` è un blocco non valido e riceve una correzione. Se è sbagliata: un turno di correzione in più.
- **R2:** il test trova `addWorktree` con `find`. Se è sbagliata: nessun costo.
- **Trailer Haiku/Sonnet:** si tengono, perché l'attribuzione è vera. Se è sbagliata: un trailer cosmetico.
- **`onRequest`:** riceve un quarto argomento, l'id rpc. Se è sbagliata: una firma da ritoccare.
- **R3:** sola lettura di default; `build` solo per il developer nel worktree. Se è sbagliata: niente chat che scrive.
- **R4:** la card di Codex mostra prima `grantRoot` e poi il motivo. Se è sbagliata: una riga più lunga.
- **R5, R7, R11:** i minor economici sono entrati nei giri di correzione. Se è sbagliata: diff un po' più grandi.
- **R6:** la nota d'avvio mostra lo sha di HEAD del progetto. Se è sbagliata: uno sha in una nota.
- **R8:** i Task 7 e 9 sono andati in un solo invio. Se è sbagliata: una review un po' più larga.
- **R9:** lo screenshot delle card non è stato fatto, perché all'agente era negato l'accesso a `node_modules\electron\dist`, e lo fa l'utente. Se è sbagliata: un difetto visivo scoperto tardi.
- **R10 (decisione dell'utente):** l'isolamento delle skill di Codex va in un follow-up, e i test live di Codex sono `test.skip`. Se è sbagliata: Codex resta inutilizzabile in Ark, ma lo era già, perché il controllo lo blocca.
- **R12:** I3 blocca: niente fiducia parziale. Se è sbagliata: chi ha queste impostazioni deve toglierle per usare la build.
- **R13:** I1 non è stato provato dal vivo, perché costa. Se è sbagliata: forse un ritocco alla sintassi delle regole.
- **R14:** i messaggi durante la build arrivano al turno successivo del developer. Se è sbagliata: il messaggio arriva in un momento diverso da quello che l'utente si aspetta.
- **R15:** un messaggio scritto durante il riepilogo finale, o dopo `done`, non arriva a nessuno. Riaprire la build è una scelta di prodotto. Se è sbagliata: il messaggio resta senza risposta.
- **R16 (decisione dell'utente: follow-up):** le sessioni di review e di security review caricano gli hook di `.claude/settings.json` del worktree senza il controllo I3, e l'ultima fase non viene mai controllata. Se è sbagliata: un hook scritto dal developer gira nella review senza card.

## Follow-up aperti

1. **Isolamento delle skill di Codex.** `codex-cli 0.132.0` rifiuta `skills/extraRoots/set` (`src/main/services/engines/codex-session.ts:72`): il suo protocollo ha solo `skills/list` e `skills/config/write`.
   - Il controllo si blocca e nessuna sessione Codex parte. Non c'è nessuna violazione.
   - Serve un nuovo modo di isolare le skill.
   - Poi bisogna:
     - togliere i `test.skip` in `tests/live/engines.live.test.ts` e `tests/live/build.live.test.ts`;
     - confermare dal vivo l'approvazione per `curl`;
     - verificare che la sandbox `workspace-write` regga su Windows nativo;
     - mostrare il `cwd` del comando nelle card di Codex;
     - aggiornare la riga "Known limit" nel README.
2. **R16 e i minor dell'ultima review:**
   - **R16:** in `conductor.ts`, nel ramo di review, dopo `ws.diff` e prima di `turn(agent)`, aggiungere `const bad = claudeSettingsProblem(b.worktree); if (bad) throw new Error(bad);`, più un test nel conductor;
   - **N1:** un `settings.json` con BOM UTF-8 viene rifiutato come JSON non valido. Basta togliere `﻿` prima del parse;
   - **N2:** l'etichetta "timed out" compare anche quando il check viene ucciso per il buffer da 64 MB;
   - **N3:** il testo della nota "Reply to continue" non corrisponde più al comportamento di R14;
   - **N4:** un sotto-titolo numerato prima della Fase 1 fa sparire tutte le fasi;
   - **I3:** non controlla `permissions.additionalDirectories` e `apiKeyHelper`;
   - **I3:** la nota di rifiuto all'avvio compare due volte;
   - **R15:** quando un messaggio arriva a un thread `done`, va mostrata una nota.
3. **Minor rimandati dei task, a bassa priorità:**
   - kill dell'albero di processi al timeout dei check;
   - test mancanti: taglio della coda a 4000 caratteri, reply-after-close, `stopAll` durante Start developer;
   - `parsePhases`: accetta "1.2" e "Version 2.0", e non salta i blocchi di codice;
   - commento vecchio in `codex-session.ts`;
   - `PhaseCard` mostra "✓ checks" anche dopo un fallimento successivo (M4);
   - il reviewer corretto riparte in una sessione nuova (M5);
   - se si esce durante il commit del piano, la fase 1 resta senza base (M6);
   - `.filter(needsYou)`.

## Prova manuale per l'utente

Usa un repo usa-e-getta, mai un progetto vero.

1. **Il giro completo** (Task 10 del piano). Su un repo piccolo con uno script `test` nel `package.json`:
   - pianifica un cambiamento in due fasi e premi **Start developer**;
   - controlla la nota (branch, base, modifiche non committate), la card di fase e la card di approvazione di `npm ci`, poi Allow;
   - lascia completare le due fasi e il riepilogo: il thread diventa `done`;
   - nel progetto, `git branch --show-current` è invariato e `git log ark/<…>` mostra il commit del piano e i commit di fase;
   - il worktree sta sotto `%APPDATA%\ark\worktrees\`;
   - metti in pausa durante un turno del developer, scrivi un messaggio e controlla che la build riprenda;
   - dopo l'uscita, in `Get-Process claude,codex` non resta nessun processo di Ark.
2. **Card e badge (R9):**
   - `PhaseCard` mostra i segni ✓/…/· e lo stato;
   - `ApprovalCard` mostra il blocco monospace e Allow/Deny, poi ✅/🚫;
   - nella sidebar compare ✋ quando c'è un'approvazione in attesa.
3. **I1:** `npm run test`, `npm run lint` e `npm test` del developer non chiedono la card, mentre `npm install left-pad` sì. Si può verificare anche con `npm run test:live`, che è a pagamento.
4. **I2:** in un progetto con husky o con un `pre-commit` che fallisce, Start developer e i commit di fase riescono, e i commit fatti da te eseguono ancora gli hook.
5. **I3:**
   - con `permissions.allow` in `.claude/settings.json`, Start developer si rifiuta e la nota nomina il file;
   - tolte quelle chiavi, parte;
   - controlla se una Write del developer su `.claude/settings.json` chiede la card.
6. **I4:** metti in pausa durante una review e scrivi "usa X": il developer riceve "The user replied", poi ripartono i check e le due review.
7. **Scrittura fuori dal worktree:** una scrittura del developer fuori dal worktree chiede la card.

## Da sapere

- Valgono le regole di sempre:
  - mai scrivere in `~/.claude`, `~/.codex` o `~/.agents`, né in `%APPDATA%\ark`;
  - commit con `git commit -F`;
  - `npm test` non chiama mai modelli.
- Il workspace SDD di questo piano è stato cancellato: la storia è in Git e in questo file.
