# Velocità

`velocita.py` è il programma principale: una finestra semplice che nasconde
il numero della velocità nei video (e nelle foto) della moto.

```bash
pip install -r requirements.txt customtkinter
python velocita.py
```

Serve **ffmpeg** per tenere l'audio e per usare più core della CPU.

### Release automatica

Quando crei un tag con la versione e lo carichi su GitHub, parte da solo lo
script in `.github/workflows/release.yml`: crea `Velocita.exe` (Windows) e
`Velocita-mac.zip` (Mac) e li mette nella release.

```bash
git tag vNUMERO_VERSIONE
git push origin vNUMERO_VERSIONE
```

---

# tachometer-blur

Pixelizza automaticamente il tachimetro/cruscotto in video onboard di moto,
con rilevamento diretto ad ogni frame (niente coordinate fisse) e fallback
manuale (disegni tu il rettangolo, il programma lo segue).

## Come funziona

1. **Detector** (`detector.py`) — cerca il display combinando due segnali
   indipendenti dal colore: densità di bordi (un cruscotto pieno di numeri
   ha molti più contorni ravvicinati dell'asfalto/cielo attorno, che sia un
   display arancione LCD, nero digitale o bianco analogico) + color-match
   arancione/ambra come booster opzionale di confidenza, più i vincoli
   geometrici comuni (aspect ratio, posizione nella metà alta del frame).
   Lavora su una versione ridotta del frame (`--detect-scale`, default 0.5 =
   metà risoluzione: Canny/morfologia scalano con l'area, quindi dimezzare
   i lati è ~4x più veloce) — abbastanza economico da girare ad **ogni
   frame**, non ogni tanto. Se in `models/` è presente un modello YOLO
   (`.pt`) e `ultralytics` è installato, viene usato al posto dell'euristica
   — nessuna dipendenza obbligatoria, hook pronto per un futuro modello
   addestrato ad hoc.
2. **Tracker** (`tracker.py`) — due strategie:
   - **modalità auto** (default): richiama il detector ad ogni frame invece
     di appoggiarsi a un tracker OpenCV. Misurato più veloce (un tracker
     CSRT/KCF costante era il vero collo di bottiglia su clip lunghe) e più
     robusto ai movimenti bruschi (curve, vibrazioni) perché non "insegue"
     mai una posizione vecchia. Se il rilevamento fallisce per pochi frame
     di fila (sfocatura, riflesso), continua a coprire l'ultima posizione
     nota per `--persistence-frames` (default 6) invece di lasciare
     scoperto il tachimetro anche solo per un istante. Il detector inoltre
     **preferisce sempre il candidato più vicino all'ultima posizione nota**
     invece del "migliore assoluto" nel frame: senza questo bias, un blob
     più convincente comparso altrove (cambio di scena, altro veicolo,
     testo su un cartello) faceva saltare via il rilevamento dal tachimetro
     reale e non ci tornava più per il resto del video — bug corretto.
   - **modalità manuale**: il bbox iniziale l'ha scelto l'utente col mouse,
     quindi qui serve un vero tracker OpenCV (KCF di default, CSRT
     disponibile) per seguirlo, con re-detection automatica di fallback se
     lo perde.
3. **Smoothing** (`common.py`) — media mobile esponenziale su centro e size
   del bounding box, per eliminare i tremolii dovuti a vibrazioni/curve.
4. **Masking** (`masking.py`) — pixelizzazione (stile "censura YouTube")
   solo sulla ROI rilevata (+ padding configurabile), preservando il resto
   del frame intatto.
5. **video_processor.py** — orchestra lettura/scrittura frame-by-frame e
   rimuxa l'audio originale con `ffmpeg` (se disponibile) alla fine, così il
   video non viene ricompresso e mantiene qualità/fps/risoluzione originali.
6. **speed_reader.py** (opzionale) — legge il numero mostrato nel display via
   OCR, usato solo se imposti `--min-speed`: sotto soglia il frame resta
   visibile, sopra soglia viene oscurato. Se la lettura fallisce per un
   frame, quel frame viene oscurato comunque (fail-safe: in caso di dubbio,
   si preferisce nascondere).
7. **gui_app.py** — interfaccia grafica che espone le stesse opzioni della
   CLI con file picker; è il sorgente da cui viene generato l'eseguibile
   Windows. Usa CustomTkinter (dark mode) se installato, altrimenti ripiega
   automaticamente su tkinter/ttk puro — nessuna dipendenza obbligatoria.

## Installazione (Windows)

```bash
py -3.12 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Per preservare l'audio serve **ffmpeg** nel PATH:

```bash
winget install ffmpeg
```

(senza ffmpeg il programma funziona comunque, ma l'output non avrà audio —
viene stampato un avviso).

### GPU NVIDIA (opzionale, solo se usi un modello YOLO)

La pipeline di default (rilevamento per densità di bordi ad ogni frame) è
**CPU-only per design**: non c'è una rete neurale da accelerare, quindi una
GPU non la velocizza. Misurato: ~125 fps su un frame 1280x720 (video da 20
minuti elaborato in ~5 minuti), grazie al rilevamento su frame ridotto
(`--detect-scale`) invece di un tracker OpenCV costante. Se in futuro
aggiungi un modello YOLO in `models/tachometer.pt` (l'unico caso in cui una
GPU aiuta davvero):

```bash
pip install ultralytics
pip install torch --index-url https://download.pytorch.org/whl/cu121  # CUDA 12.1
```

`ultralytics` seleziona automaticamente la GPU se `torch` la rileva.

### OCR per soglia velocità (opzionale, solo per `--min-speed`)

**Se usi l'eseguibile `TachometerBlur.exe`, l'OCR funziona subito**: la build
include già Tesseract (in `tesseract_bundle/`), non serve installare nulla
a parte.

Se invece lavori dal sorgente Python:

```bash
pip install pytesseract
```

Serve anche il **binario** Tesseract OCR (non basta il pacchetto Python).
`speed_reader.py` cerca prima una cartella `tesseract_bundle/` accanto ai
sorgenti (vedi sotto come generarla) e solo se non la trova ripiega sul
Tesseract di sistema:

```bash
winget install --id UB-Mannheim.TesseractOCR
```

Senza né l'uno né l'altro, `--min-speed` si rifiuta di partire con un errore
chiaro invece di eseguire senza avvisare.

## Uso

```bash
python tachometer_blur.py input.mp4 output.mp4 --mode auto
python tachometer_blur.py input.mp4 output.mp4 --mode manual
```

Preview (elabora solo i primi 10 secondi, utile per validare i parametri
prima di lanciare il video intero):

```bash
python tachometer_blur.py input.mp4 preview.mp4 --preview 10
```

### Modalità

- `--mode auto` (default): rilevamento diretto ad ogni frame, nessuna
  interazione richiesta.
- `--mode manual`: viene mostrato il primo frame **in una finestra separata**
  (non fa parte della GUI/CLI, è una finestra nativa di OpenCV — se non la
  vedi comparire, controlla dietro le altre finestre o nella barra delle
  applicazioni). Disegna un rettangolo col mouse attorno al tachimetro,
  poi INVIO o SPAZIO per confermare (C per annullare): da lì il tachimetro
  viene tracciato per tutto il video con un tracker OpenCV, senza bisogno
  del rilevamento automatico. **Usa sempre questa modalità se `auto` non
  trova il display** (es. cruscotti molto scuri/poco contrastati, forme
  inusuali, inquadrature particolari) — è il fallback pensato apposta per
  quel caso, non richiede che il rilevatore riconosca nulla.

### Opzioni principali

| Flag | Default | Descrizione |
|---|---|---|
| `--pixelate-block` | `12` | dimensione blocco pixelizzazione, più alto = meno leggibile |
| `--mask-padding` | `10` | margine px attorno al bbox rilevato |
| `--detect-scale` | `0.5` | scala del frame per il rilevamento: più basso = più veloce, meno preciso |
| `--persistence-frames` | `6` | per quanti frame coprire l'ultima posizione nota se il rilevamento fallisce |
| `--tracker` | `kcf` | solo `--mode manual`: `kcf` (più veloce) \| `csrt` (più preciso, più lento) |
| `--detect-interval` / `--track-fail-streak` | `1` / `3` | solo `--mode manual`: quando forzare una re-detection |
| `--smoothing-alpha` | `0.3` | 0-1, più basso = più stabile ma più lag |
| `--hue-min` / `--hue-max` | `0` / `30` | range HSV per il booster di colore |
| `--preview` | `0` | elabora solo i primi N secondi |
| `--min-speed` | `0` | oscura solo se la velocità letta via OCR è >= N km/h (0 = oscura sempre); richiede il binario Tesseract (già incluso nell'exe) |
| `--speed-check-interval` | `3` | ogni quanti frame ri-leggere la velocità (solo con `--min-speed`) |
| `--quiet` | off | disabilita la barra di progresso |

## Struttura

```
tachometer_blur.py   # CLI (argparse)
gui_app.py             # GUI tkinter/CustomTkinter (sorgente dell'exe)
detector.py             # rilevamento (euristico + hook YOLO opzionale)
tracker.py               # detect-every-frame (auto) + tracker OpenCV (manuale)
masking.py               # pixelizzazione
video_processor.py      # I/O video, audio muxing, preview, gate velocità
speed_reader.py          # OCR opzionale per --min-speed
common.py                # BBox, smoothing EMA
models/                  # posto un futuro modello .pt custom qui
tests/                    # pytest, tutto su video/frame sintetici
```

## Eseguibile Windows (GUI)

La GUI ([gui_app.py](gui_app.py)) espone file picker per input/output, tutte
le opzioni principali, un pulsante **Interrompi** per fermare l'elaborazione
in corso (il file parziale viene ripulito, non resta un output a metà), e un
log che mostra in tempo reale la fase corrente (apertura video, percentuale
di avanzamento, sincronizzazione audio...).

Per il look dark mode installa anche `customtkinter` prima del build (se
manca, la GUI funziona comunque con tkinter/ttk puro):

```bash
pip install customtkinter
```

Per generare un `.exe` standalone (non richiede Python installato per
essere eseguito):

```bash
pip install pyinstaller
pyinstaller --onefile --windowed --name TachometerBlur ^
  --add-data "tesseract_bundle;tesseract_bundle" ^
  gui_app.py
```

L'eseguibile viene creato in `dist\TachometerBlur.exe` (~160MB, include
Tesseract OCR pronto all'uso — l'opzione "Oscura solo sopra X km/h" funziona
subito, senza installare nulla a parte). Nota: l'exe non include ffmpeg — se
vuoi preservare l'audio, installalo comunque separatamente sulla macchina
che esegue l'exe (vedi sopra); senza, l'output funziona ma senza audio.

### Rigenerare `tesseract_bundle/` (se non presente nel repo)

`tesseract_bundle/` non è tracciato in git per via della dimensione
(~135MB). Per ricrearlo su una macchina con Tesseract OCR già installato
(`winget install --id UB-Mannheim.TesseractOCR`):

```powershell
mkdir tesseract_bundle\tessdata
copy "C:\Program Files\Tesseract-OCR\tesseract.exe" tesseract_bundle\
copy "C:\Program Files\Tesseract-OCR\*.dll" tesseract_bundle\
del tesseract_bundle\libicudt75.dll   # non serve per leggere cifre, risparmia ~30MB
copy "C:\Program Files\Tesseract-OCR\tessdata\eng.traineddata" tesseract_bundle\tessdata\
```

## Test

```bash
pip install pytest
pytest tests/ -v
```

## Limiti noti

- Il rilevamento per bordi/colore funziona bene su cruscotti con testo/numeri
  a buon contrasto (arancione LCD, nero digitale, bianco analogico); su
  display molto scuri/poco contrastati o forme inusuali, **usa `--mode
  manual`** — è il fallback pensato apposta, disegni tu il rettangolo una
  volta sola e il tracker lo segue per tutto il video.
- Se il tachimetro è quasi completamente coperto (mano, riflesso forte) per
  più frame di `--persistence-frames`, il frame viene scritto senza maschera
  finché non si ri-aggancia. Per video critici, alza `--persistence-frames`.
- Per un rilevamento davvero robusto su una flotta di video eterogenei, la
  strada consigliata è addestrare un modello YOLO piccolo (es. `yolov8n`) su
  qualche decina di frame annotati del proprio cruscotto e metterlo in
  `models/tachometer.pt`: il detector lo userà automaticamente.
