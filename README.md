# Velocità

App per Mac e Windows che nasconde il numero della velocità nei video (e nelle foto) della moto.
Trova il cruscotto arancione in ogni fotogramma e pixela il numero.

Fatta con **Tauri**: la finestra è in HTML/CSS/JS, il lavoro lo fa Rust, video e audio li gestisce ffmpeg (incluso nell'app).

## Cartelle

| Cartella | Cosa c'è |
|---|---|
| `ui/` | la finestra: `index.html`, `stile.css`, `app.js` |
| `src-tauri/` | l'app Tauri: comandi che la finestra chiama (`src/main.rs`) e impostazioni (`tauri.conf.json`) |
| `motore/` | il motore in Rust: trova il cruscotto e pixela (`rilevamento.rs`), legge e scrive i video (`video.rs`) |
| `scripts/prendi_ffmpeg.py` | scarica ffmpeg per il computer giusto |
| `.github/workflows/release.yml` | crea gli installer e la release quando carichi un tag |

## Provarla sul Mac

Serve: Rust, Node.js e Python 3.

```bash
npm install
npm run ffmpeg
npm run dev
```

## Impostazioni del display

In **Impostazioni → Display**:

- **Momento**: Automatico (capisce da solo se il video è di giorno o di notte), Giorno o Notte
- **Colore del display**: arancione, rosso, giallo, verde, blu o bianco
- **Colore preso dal video**: con **Scegli…** clicchi sul display nell'anteprima e l'app cerca quel colore

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
