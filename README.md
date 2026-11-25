# Velocità

App per Mac e Windows che nasconde il numero della velocità nei video (e nelle foto) della moto.
Trova il cruscotto arancione in ogni fotogramma e pixela il numero.

Fatta con **Tauri**: la finestra è in HTML/CSS/JS, il lavoro lo fa Rust, video e audio li gestisce ffmpeg (incluso nell'app).

## Cartelle

| Cartella | Cosa c'è |
|---|---|
| `ui/` | la finestra: `index.html`, `stile.css`, `app.js`, e le traduzioni in `lingue.js` |
| `src-tauri/` | l'app Tauri: comandi che la finestra chiama (`src/main.rs`) e impostazioni (`tauri.conf.json`) |
| `motore/` | il motore in Rust: trova il cruscotto e pixela (`rilevamento.rs`), legge e scrive i video (`video.rs`), trova le facce (`volti.rs`), segue gli oggetti come le targhe (`segui.rs`) |
| `motore/modelli/` | il modello per riconoscere le facce (SeetaFace, licenza BSD in `LICENZA_seeta_fd.txt`) |
| `scripts/prendi_ffmpeg.py` | scarica ffmpeg per il computer giusto |
| `.github/workflows/release.yml` | crea gli installer e la release quando carichi un tag |

## Provarla sul Mac

Serve: Rust, Node.js e Python 3.

```bash
npm install
npm run ffmpeg
npm run dev
```

## Striscia colorata e zona regolabile

Quando apri un video, Velocità lo controlla velocemente in sottofondo
(2 punti al secondo, solo i fotogrammi chiave) e colora la striscia sotto
l'anteprima:

- **verde**: display trovato, il numero è coperto
- **arancione**: trovato ma con poca sicurezza (c'è un'altra zona simile, o il display "salta"): meglio controllare
- **rosso**: display non trovato, lì il numero potrebbe vedersi

Clicca sulla striscia per andare in quel punto.

Con **Zona → Regola…** (o doppio clic sull'anteprima) sposti e ingrandisci a mano
la zona coperta. La regolazione vale per tutto il video e segue il display
anche quando si muove. **Ripristina** torna alla zona automatica.

## Copertura, colori e parti del video

- **Stile**: pixel, sfocato, nero o tinta unita (il colore medio della zona). Con **Guarda 3 s** vedi 3 secondi del risultato prima di esportare.
- **Margine**: Piccolo, Normale, Grande o **Manuale** (da 0 a 50%).
- **Parte del video**: sposta il cursore e premi **Da qui** / **Fino a qui** per salvare solo un pezzo (anche l'audio).
- **Colori e 10 bit**: il video esce con le stesse informazioni sui colori dell'originale. I video a 10 bit (per esempio HLG o D-Log M) escono in HEVC a 10 bit, pronti per la correzione colore in DaVinci.
- **Coda**: trascina i file per cambiare l'ordine; con **Cartella…** aggiungi tutti i video e le foto di una cartella (i file già coperti, `_speed_blur`, si saltano).

## Scorciatoie

Sul Mac ci sono anche nel menu in alto (Aiuto › Scorciatoie da tastiera).

- **⌘O** (Ctrl+O su Windows): aggiungi video o foto · **⌘⇧O**: una cartella
- **⌘↩**: Avvia
- **⌘,** (Ctrl+, su Windows): Impostazioni
- **← →**: un secondo avanti o indietro (con **⇧** 10 secondi)
- **Frecce sulla striscia**: salta al prossimo punto da controllare
- **I** e **O**: inizio e fine del pezzo da salvare
- **Spazio**: guarda 3 secondi del risultato
- **R**: originale o risultato · **F**: schermo intero (Esc per uscire)
- **⌥↑ ⌥↓**: cambia l'ordine della coda · **Canc**: togli il file selezionato
- **Regola la zona**: frecce per spostare, ⇧ + frecce per la grandezza, ↩ applica, Esc annulla
- **Esc**: chiude le Impostazioni

## Controlli prima di esportare

- Tutti i video della coda vengono analizzati uno dopo l'altro: nella lista
  ogni file ha un pallino (verde, arancione, rosso) e una scritta.
- Se in un video ci sono tratti rossi (dentro il pezzo da salvare), prima di
  partire l'app lo dice: «Controlla» porta al primo punto, «Esporta lo stesso»
  parte comunque.
- Alla fine, sui file da sistemare c'è «Correggi»: torna al video, sul punto
  che non va. «Torna ai video» tiene la coda com'era.
- Se il lavoro dura da più di un minuto, «Interrompi» chiede conferma. Anche
  chiudere la finestra mentre lavora chiede conferma.

## Zone a mano, targhe e volti

- **Zone a mano** ("Copri qui…" o "Copri a mano un tratto rosso"): dove il display
  non viene trovato disegni tu il rettangolo da coprire, e scegli da quando a quando
  vale (‹ › = mezzo secondo). Sulla striscia quei tratti diventano blu.
- **Segue** (nella stessa barra): invece di restare ferma, la zona va dietro
  all'oggetto che si muove, per esempio una **targa**. Disegnala nel punto dove
  l'oggetto compare: da lì lo segue finché lo vede.
- **Copri anche i volti** (in "Per tutti i video"): copre le facce delle persone
  viste di fronte. Rende l'esportazione più lenta.
- **Velocità in sottotitoli** non c'è: nei video della Osmo Nano il numero sul
  display è troppo piccolo e sfocato per leggerlo, anche a occhio.

## Altre comodità

- **Originale / Risultato** in alto a sinistra nell'anteprima, e **schermo intero**.
- **Preset**: salvi stile, forza, margine e display con un nome e li riusi con un clic.
- **Cartella sorvegliata** (Impostazioni › Generale): con l'app aperta, i video
  nuovi messi lì vengono coperti da soli.
- Mentre esporta il computer **non va in stop**, e il file finito ha la **stessa
  data** dell'originale (così in DaVinci resta in ordine).
- La barra di avanzamento si vede anche sull'icona (Dock del Mac, barra di Windows).
- Su Windows il video si crea con la **scheda video** (NVIDIA, Intel o AMD), se c'è.
- **Lingue**: italiano, inglese e tedesco (Impostazioni › Generale › Lingua).
  Per aggiungere una frase: scrivila in italiano nel codice e mettila in `ui/lingue.js`.

## Test automatici

```bash
cargo test -p motore
```

Controlla che il display venga trovato nei fotogrammi di esempio in
`motore/tests/fotogrammi` (lampioni, muri, strada illuminata, riflessi...),
e anche zone a mano, oggetti seguiti, facce, colori e schede video.
GitHub Actions li fa girare prima di ogni release: se un test fallisce, la
release non viene creata.

## Impostazioni del display

In **Impostazioni → Display**:

- **Momento**: Automatico (capisce da solo se il video è di giorno o di notte), Giorno o Notte
- **Colore del display**: arancione, rosso, giallo, verde, blu o bianco
- **Colore preso dal video**: con **Scegli…** clicchi sul display nell'anteprima e l'app cerca quel colore
- **Posizione del display**: In basso (cerca solo nella metà bassa del video, consigliato) oppure Ovunque

Nell'anteprima, in basso a sinistra, una scritta piccola (es. «Notte · Arancione») dice cosa sta usando l'app.

Le soglie per giorno e notte sono in `motore/src/rilevamento.rs` (`SOGLIE_GIORNO`, `SOGLIE_NOTTE`).

## Release e aggiornamenti automatici

Carichi un tag con la versione (v minuscola). Il messaggio del tag è la novità che l'app mostra nell'avviso di aggiornamento:

```bash
git tag -a v1.2.3 -m "Anteprima più veloce"
git push origin v1.2.3
```

GitHub Actions crea l'installer per Mac (`.dmg`, Apple Silicon e Intel) e per Windows (`.exe`), e il file `latest.json`.
All'avvio l'app guarda `latest.json` dell'ultima release: se c'è una versione nuova mostra l'avviso con **Aggiorna**.

Per provare senza fare una release: **Actions → Release → Run workflow**. Gli installer sono in fondo alla pagina del run.

### Chiave degli aggiornamenti (da fare una volta)

Gli aggiornamenti sono firmati: l'app installa solo file creati con la tua chiave.

1. Sul Mac: `npm run tauri signer generate -- -w ~/.tauri/velocita.key`
2. Il contenuto di `~/.tauri/velocita.key.pub` va in `src-tauri/tauri.conf.json` al posto di `METTI_QUI_LA_CHIAVE_PUBBLICA`
3. Su GitHub, **Settings → Secrets and variables → Actions**, crea:
   - `TAURI_SIGNING_PRIVATE_KEY` con il contenuto di `~/.tauri/velocita.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con la password che hai scelto

Non perdere `velocita.key`: senza, le app già installate non possono più aggiornarsi.

## Primo avvio

L'app è firmata in modo gratuito (ad-hoc), non con un certificato Apple a pagamento.

- **Mac**: la prima volta macOS la blocca. Vai in **Impostazioni di Sistema → Privacy e sicurezza** e premi **Apri comunque**. Gli aggiornamenti dopo non chiedono più niente.
- **Windows**: se compare "Windows ha protetto il PC", premi **Ulteriori informazioni → Esegui comunque**.
