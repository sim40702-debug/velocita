import os
import sys
import cv2
import numpy as np
import subprocess
import shutil
import time
import threading
import queue
import multiprocessing as mp
import tempfile
import tkinter as tk
from tkinter import filedialog, messagebox

# Importazione GUI CustomTkinter (opzionale)
try:
    import customtkinter as ctk
    USE_CTK = True
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")
except ImportError:
    from tkinter import ttk
    USE_CTK = False


# ==========================================
# CONFIGURAZIONE ZONA DA SFUOCARE
# ==========================================

# Del riquadro arancione rilevato, sfuoca solo la parte centrale (dove sta
# il numero della velocità), non l'intero display (giri motore, spie, ecc.).
# Sono le percentuali di larghezza/altezza del riquadro arancione da tenere,
# centrate: 1.0 = tutto il riquadro, 0.5 = solo la metà centrale.
CENTRO_LARGHEZZA = 0.55
CENTRO_ALTEZZA = 0.80

# Sposta il riquadro verso il basso: frazione dell'altezza del riquadro
# arancione di cui scendere (0 = resta centrato, 0.2 = scende del 20%).
OFFSET_VERTICALE = 0.18

# Dimensione dei "blocchi" della pixelizzazione: più alto = più illeggibile
# (e anche più veloce, perché lavora su un'immagine più piccola).
BLOCCO_PIXEL = 10

# La posizione del display cambia nel frame se muovi la testa (es. per
# guardare una curva): per non lasciare mai scoperta la velocità, il
# rilevamento gira ad OGNI frame (non più ogni tot). Per restare comunque
# veloce, il rilevamento lavora su una versione ridotta del frame (non su
# quello a piena risoluzione): SCALA_RILEVAMENTO = 1.0 è la qualità
# massima (più lento), 0.4-0.6 è un buon compromesso velocità/precisione.
SCALA_RILEVAMENTO = 0.5

# Margine di sicurezza aggiunto attorno alla zona arancione rilevata (in
# percentuale della sua dimensione): utile se il display finisce vicino al
# bordo dell'inquadratura e il contorno rilevato risulta "tagliato".
MARGINE_SICUREZZA = 0.15

# Se per qualche frame il rilevamento fallisce (es. sfocatura da movimento
# rapido della testa), continua comunque a coprire l'ultima posizione nota
# per questi frame, invece di lasciare scoperto il numero anche solo per
# un istante.
PERSISTENZA_FRAME = 6

# Regola questi valori guardando l'output in modalità DEBUG (riquadro
# rosso = zona che verrà sfuocata) finché non copre bene il numero.

# Estensioni trattate come foto (tutte le altre vengono aperte come video)
ESTENSIONI_IMMAGINI = [".jpg", ".jpeg", ".png", ".webp"]


# ==========================================
# RILEVAMENTO DISPLAY + PIXELIZZAZIONE
# ==========================================

class SpeedDisplayProcessor:
    """
    Localizza il display arancione (maschera HSV + contorno più grande) ad
    ogni frame (per seguirlo anche quando la telecamera si muove, es. si
    gira la testa), poi restringe la zona a una porzione centrale/più
    bassa (dove sta il numero della velocità) e la pixelizza (stile
    "censura YouTube"). Se il rilevamento fallisce per pochi frame di
    fila, continua a coprire l'ultima posizione nota (PERSISTENZA_FRAME)
    invece di lasciare scoperto il numero.
    In modalità debug disegna il riquadro verde (zona arancione rilevata)
    e quello rosso (zona che verrebbe pixelizzata), senza applicare alcun
    effetto, per tarare i parametri qui sopra.
    """

    def __init__(self, debug=False):
        self.debug = debug
        self._ultimo_box = None       # (x, y, w, h) nel sistema di coordinate originale
        self._persistenza_rimasta = 0  # frame residui in cui fidarsi ancora dell'ultimo box

    def _trova_display(self, frame):
        h_full, w_full = frame.shape[:2]

        # Rileva su una versione ridotta del frame: molto più veloce, e
        # possiamo comunque farlo ad ogni frame senza rallentare troppo.
        piccola = cv2.resize(frame, None, fx=SCALA_RILEVAMENTO, fy=SCALA_RILEVAMENTO,
                              interpolation=cv2.INTER_LINEAR)

        hsv = cv2.cvtColor(piccola, cv2.COLOR_BGR2HSV)
        lower_orange = np.array([0, 100, 100])
        upper_orange = np.array([25, 255, 255])

        mask = cv2.inRange(hsv, lower_orange, upper_orange)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return None

        c = max(contours, key=cv2.contourArea)
        area_minima = 500 * (SCALA_RILEVAMENTO ** 2)  # proporzionata alla scala ridotta
        if cv2.contourArea(c) <= area_minima:
            return None

        x, y, w, h = cv2.boundingRect(c)

        # Riporta le coordinate alla risoluzione originale del frame
        inv = 1.0 / SCALA_RILEVAMENTO
        x, y, w, h = int(x * inv), int(y * inv), int(w * inv), int(h * inv)

        # Aggiunge un margine di sicurezza attorno, senza uscire dal frame
        pad_x = int(w * MARGINE_SICUREZZA)
        pad_y = int(h * MARGINE_SICUREZZA)
        x2 = min(w_full, x + w + pad_x)
        y2 = min(h_full, y + h + pad_y)
        x = max(0, x - pad_x)
        y = max(0, y - pad_y)

        return x, y, x2 - x, y2 - y

    def _regione_centrale(self, box, frame_shape):
        x, y, w, h = box
        h_full, w_full = frame_shape[:2]

        # Se il rettangolo rilevato tocca il bordo dell'inquadratura, il
        # display è quasi certamente tagliato (es. mentre si gira la testa
        # per guardare una curva): non ci si può fidare che il numero sia
        # esattamente dove ce lo aspetteremmo da una vista frontale, quindi
        # per sicurezza si copre quasi tutta la zona rilevata, non solo il
        # centro.
        margine_bordo = 3
        tocca_bordo = (
            x <= margine_bordo or y <= margine_bordo or
            x + w >= w_full - margine_bordo or y + h >= h_full - margine_bordo
        )

        if tocca_bordo:
            larghezza_frac = 0.95
            altezza_frac = 0.95
            offset_vert = 0.05
        else:
            larghezza_frac = CENTRO_LARGHEZZA
            altezza_frac = CENTRO_ALTEZZA
            offset_vert = OFFSET_VERTICALE

        margin_x = int(w * (1 - larghezza_frac) / 2)
        margin_y = int(h * (1 - altezza_frac) / 2)

        cw = max(1, w - 2 * margin_x)
        ch = max(1, h - 2 * margin_y)
        cx = x + margin_x

        cy = y + margin_y + int(h * offset_vert)
        if cy + ch > y + h:
            cy = max(y, y + h - ch)

        return cx, cy, cw, ch

    def _pixella(self, roi):
        h, w = roi.shape[:2]
        fattore = max(1, min(w, h) // BLOCCO_PIXEL)
        small_w = max(1, w // fattore)
        small_h = max(1, h // fattore)
        small = cv2.resize(roi, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
        return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)

    def process_frame(self, frame):
        box_trovato = self._trova_display(frame)

        if box_trovato is not None:
            self._ultimo_box = box_trovato
            self._persistenza_rimasta = PERSISTENZA_FRAME
        elif self._persistenza_rimasta > 0:
            self._persistenza_rimasta -= 1
            # tiene self._ultimo_box così com'è per qualche frame in più
        else:
            self._ultimo_box = None

        box = self._ultimo_box
        if box is None:
            return frame

        x, y, w, h = box
        cx, cy, cw, ch = self._regione_centrale(box, frame.shape)

        if self.debug:
            cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
            cv2.rectangle(frame, (cx, cy), (cx + cw, cy + ch), (0, 0, 255), 2)
        else:
            roi = frame[cy:cy + ch, cx:cx + cw]
            if roi.size > 0:
                frame[cy:cy + ch, cx:cx + cw] = self._pixella(roi)

        return frame


# ==========================================
# GESTIONE AUTOMATICA DEI CORE CPU
# ==========================================

# Numero totale di core/thread rilevati sul PC.
CPU_TOTALI = os.cpu_count() or 4

# Percentuale di core usata da ciascuna opzione della GUI "CPU Workers".
# AUTO corrisponde al 50%: un buon compromesso, lascia sempre metà dei
# core liberi per il resto del sistema (GUI, altri programmi) invece di
# saturare tutta la macchina.
PERCENTUALI_CPU_WORKERS = {
    "Auto": 0.50,
    "25%": 0.25,
    "50%": 0.50,
    "75%": 0.75,
    "100%": 1.00,
}

# Tetto massimo assoluto di processi, indipendentemente dalla percentuale
# scelta. Anche su macchine con moltissimi core/thread non conviene andare
# oltre: troppi processi in parallelo su un video 4K60 significano troppi
# file temporanei aperti insieme e troppa contesa sul disco. È anche il
# punto in cui, se in futuro si aggiungesse elaborazione via GPU (CUDA),
# andrebbe applicato un limite analogo per non saturare la VRAM (es. 8 GB):
# ogni processo GPU tiene occupata della memoria video, quindi il numero
# di processi concorrenti va tenuto basso indipendentemente dai core CPU.
MAX_WORKER_ASSOLUTO = 16

# Non ha senso creare un processo per pochi fotogrammi (l'avvio di un
# processo ha un costo): ogni "pezzo" di video assegnato a un processo
# deve avere almeno questi frame.
FRAME_MINIMI_PER_PROCESSO = 40


def calcola_numero_worker(percentuale, cpu_totali=CPU_TOTALI):
    """
    Traduce una percentuale (es. 0.5 = 50%) nel numero di processi worker
    da usare, arrotondando in modo "classico" (0.5 sempre per eccesso, non
    l'arrotondamento bancario di Python), garantendo sempre almeno 1
    worker e senza mai superare i core reali disponibili né il tetto di
    sicurezza MAX_WORKER_ASSOLUTO.
    Esempio: 12 core disponibili, percentuale 0.5 -> 6 worker.
    """
    grezzo = cpu_totali * percentuale
    worker = int(grezzo + 0.5)
    worker = max(1, worker)
    worker = min(worker, cpu_totali)
    worker = min(worker, MAX_WORKER_ASSOLUTO)
    return worker


# ==========================================
# ELABORAZIONE PARALLELA (worker multiprocesso)
# ==========================================

# Frame di "riscaldamento" letti prima dell'inizio ufficiale di ogni pezzo:
# servono solo a far individuare il display al rilevatore (che tiene
# memoria degli ultimi frame) prima di iniziare davvero a scrivere, così
# anche il primo frame scritto da ogni pezzo è già coperto correttamente.
FRAME_RISCALDAMENTO = 6


def _elabora_segmento(video_path, start_frame, num_frame, debug, out_path,
                       fps, frame_w, frame_h, contatore_progresso):
    """
    Funzione eseguita in un processo separato: apre il video, si posiziona
    all'inizio del proprio pezzo, elabora num_frame fotogrammi e li scrive
    in un file video temporaneo tutto suo. Deve stare a livello di modulo
    (non essere un metodo di classe GUI) per poter essere eseguita da
    multiprocessing su tutte le piattaforme.
    """
    # OpenCV di suo usa tutti i core per ogni operazione: con tanti
    # processi insieme si rubavano la CPU a vicenda. Ogni processo usa
    # un core solo, a dividere il lavoro ci pensano i worker.
    cv2.setNumThreads(1)

    processor = SpeedDisplayProcessor(debug=debug)

    cap = cv2.VideoCapture(video_path)
    inizio_lettura = max(0, start_frame - FRAME_RISCALDAMENTO)
    cap.set(cv2.CAP_PROP_POS_FRAMES, inizio_lettura)

    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(out_path, fourcc, fps, (frame_w, frame_h))

    frame_idx = inizio_lettura
    scritti = 0
    while scritti < num_frame:
        ret, frame = cap.read()
        if not ret:
            break

        processed = processor.process_frame(frame)

        if frame_idx >= start_frame:
            out.write(processed)
            scritti += 1
            contatore_progresso.value = scritti

        frame_idx += 1

    cap.release()
    out.release()


# ==========================================
# STILE GRAFICO (stile Apple)
# ==========================================

# Font di sistema: SF Pro su Mac, Segoe UI su Windows
if sys.platform == "darwin":
    FONT_SISTEMA = ".AppleSystemUIFont"
elif sys.platform.startswith("win"):
    FONT_SISTEMA = "Segoe UI"
else:
    FONT_SISTEMA = "Helvetica"

# Colori: ogni coppia è (tema chiaro, tema scuro). CustomTkinter sceglie
# da solo quello giusto in base al tema del Mac/Windows.
BLU = "#0a84ff"
BLU_HOVER = "#0071e3"
COLORE_SFONDO = ("#f2f2f7", "#1e1e1e")
COLORE_SCHEDA = ("#ffffff", "#2c2c2e")
COLORE_TESTO = ("#1d1d1f", "#f5f5f7")
COLORE_GRIGIO = ("#86868b", "#98989d")
COLORE_PULSANTE = ("#e9e9ed", "#3a3a3c")
COLORE_PULSANTE_HOVER = ("#dcdce1", "#48484a")
COLORE_SEPARATORE = ("#e5e5ea", "#3a3a3c")
COLORE_SELEZIONATO = ("#ffffff", "#636366")


def formatta_tempo(secondi):
    """Trasforma i secondi in testo tipo "1:05" (o "1:02:05" se più di un'ora)."""
    secondi = int(secondi)
    ore = secondi // 3600
    minuti = (secondi % 3600) // 60
    sec = secondi % 60
    if ore > 0:
        return f"{ore}:{minuti:02d}:{sec:02d}"
    return f"{minuti}:{sec:02d}"


def trova_ffmpeg():
    """Cerca ffmpeg: prima quello messo dentro l'app (release), poi quello installato."""
    # quando il programma è un .exe o un'app Mac, i file inclusi stanno in sys._MEIPASS
    if getattr(sys, "frozen", False):
        nome = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
        percorso = os.path.join(sys._MEIPASS, nome)
        if os.path.exists(percorso):
            return percorso
    return shutil.which("ffmpeg")


# ==========================================
# INTERFACCIA GRAFICA (GUI)
# ==========================================

class ModernSpeedometerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Velocità")

        self.input_path = ""
        self.output_dir = ""
        self._output_path = ""
        self._elaborazione_in_corso = False
        self._log_visibile = False
        self._stop_event = threading.Event()

        # Il thread di elaborazione non può aggiornare la finestra da solo:
        # mette le richieste in questa coda e la finestra la controlla
        # ogni 100 ms (vedi _controlla_coda).
        self._coda = queue.Queue()

        self._build_gui()
        self.root.after(100, self._controlla_coda)
        self.root.protocol("WM_DELETE_WINDOW", self._esci)
        # su Mac anche Cmd+Q passa dalla conferma se sta lavorando
        if sys.platform == "darwin":
            self.root.createcommand("tk::mac::Quit", self._esci)

    def _build_gui(self):
        # variabile condivisa dalle due UI per la scelta "Uso CPU"
        if USE_CTK:
            self.opzione_cpu_var = ctk.StringVar(value="Auto")
            self._build_customtkinter_ui()
        else:
            self.opzione_cpu_var = tk.StringVar(value="Auto")
            self._build_standard_ui()
        self.root.resizable(False, False)

    # ---------- grafica con CustomTkinter (quella normale) ----------

    def _font(self, size, bold=False):
        return ctk.CTkFont(family=FONT_SISTEMA, size=size, weight="bold" if bold else "normal")

    def _pulsante_grigio(self, parent, testo, comando):
        """Pulsante piccolo e grigio, come "Scegli…" nelle app Apple."""
        return ctk.CTkButton(
            parent, text=testo, command=comando, width=80, height=24, corner_radius=6,
            fg_color=COLORE_PULSANTE, hover_color=COLORE_PULSANTE_HOVER,
            text_color=COLORE_TESTO, font=self._font(12)
        )

    def _separatore(self, scheda, riga):
        """Linea sottile tra due righe della stessa scheda."""
        linea = ctk.CTkFrame(scheda, height=1, fg_color=COLORE_SEPARATORE)
        linea.grid(row=riga, column=0, columnspan=3, sticky="ew", padx=(12, 0))

    def _build_customtkinter_ui(self):
        self.root.configure(fg_color=COLORE_SFONDO)

        pagina = ctk.CTkFrame(self.root, fg_color="transparent")
        pagina.pack(fill="both", expand=True, padx=24, pady=(20, 22))
        pagina.grid_columnconfigure(0, weight=1)

        # --- titolo ---
        ctk.CTkLabel(pagina, text="Velocità", font=self._font(26, bold=True),
                     text_color=COLORE_TESTO, anchor="w").grid(row=0, column=0, sticky="w")
        ctk.CTkLabel(pagina, text="Nasconde il numero della velocità nei video della moto.",
                     font=self._font(13), text_color=COLORE_GRIGIO, anchor="w"
                     ).grid(row=1, column=0, sticky="w", pady=(0, 18))

        # --- scheda FILE ---
        ctk.CTkLabel(pagina, text="FILE", font=self._font(11), text_color=COLORE_GRIGIO,
                     anchor="w").grid(row=2, column=0, sticky="w", padx=6, pady=(0, 4))

        scheda_file = ctk.CTkFrame(pagina, corner_radius=10, fg_color=COLORE_SCHEDA)
        scheda_file.grid(row=3, column=0, sticky="ew", pady=(0, 18))
        scheda_file.grid_columnconfigure(1, weight=1)

        ctk.CTkLabel(scheda_file, text="Video", font=self._font(13), text_color=COLORE_TESTO
                     ).grid(row=0, column=0, padx=(12, 8), pady=9, sticky="w")
        self.lbl_video = ctk.CTkLabel(scheda_file, text="Nessun file", font=self._font(13),
                                      text_color=COLORE_GRIGIO, anchor="e", width=230)
        self.lbl_video.grid(row=0, column=1, sticky="e")
        self._pulsante_grigio(scheda_file, "Scegli…", self._select_input
                              ).grid(row=0, column=2, padx=12, pady=9)

        self._separatore(scheda_file, 1)

        ctk.CTkLabel(scheda_file, text="Salva in", font=self._font(13), text_color=COLORE_TESTO
                     ).grid(row=2, column=0, padx=(12, 8), pady=9, sticky="w")
        self.lbl_cartella = ctk.CTkLabel(scheda_file, text="Accanto al video", font=self._font(13),
                                         text_color=COLORE_GRIGIO, anchor="e", width=230)
        self.lbl_cartella.grid(row=2, column=1, sticky="e")
        self._pulsante_grigio(scheda_file, "Cambia…", self._select_output
                              ).grid(row=2, column=2, padx=12, pady=9)

        # --- scheda OPZIONI ---
        ctk.CTkLabel(pagina, text="OPZIONI", font=self._font(11), text_color=COLORE_GRIGIO,
                     anchor="w").grid(row=4, column=0, sticky="w", padx=6, pady=(0, 4))

        scheda_opzioni = ctk.CTkFrame(pagina, corner_radius=10, fg_color=COLORE_SCHEDA)
        scheda_opzioni.grid(row=5, column=0, sticky="ew", pady=(0, 20))
        scheda_opzioni.grid_columnconfigure(1, weight=1)

        # "Mostra i riquadri" = la vecchia modalità Debug Visivo:
        # verde = zona rilevata, rosso = zona che verrebbe sfuocata
        ctk.CTkLabel(scheda_opzioni, text="Mostra i riquadri (prova)", font=self._font(13),
                     text_color=COLORE_TESTO).grid(row=0, column=0, padx=12, pady=10, sticky="w")
        self.switch_debug = ctk.CTkSwitch(scheda_opzioni, text="", width=44,
                                          switch_width=40, switch_height=22,
                                          progress_color=BLU, button_color="#ffffff",
                                          button_hover_color="#ffffff", fg_color=COLORE_PULSANTE_HOVER)
        self.switch_debug.grid(row=0, column=2, padx=(0, 4), pady=10, sticky="e")

        self._separatore(scheda_opzioni, 1)

        ctk.CTkLabel(scheda_opzioni, text="Uso CPU", font=self._font(13),
                     text_color=COLORE_TESTO).grid(row=2, column=0, padx=12, pady=10, sticky="w")
        ctk.CTkSegmentedButton(
            scheda_opzioni, variable=self.opzione_cpu_var,
            values=list(PERCENTUALI_CPU_WORKERS.keys()), font=self._font(12), height=26,
            fg_color=COLORE_PULSANTE, unselected_color=COLORE_PULSANTE,
            unselected_hover_color=COLORE_PULSANTE_HOVER,
            selected_color=COLORE_SELEZIONATO, selected_hover_color=COLORE_SELEZIONATO,
            text_color=COLORE_TESTO
        ).grid(row=2, column=2, padx=12, pady=10, sticky="e")

        # --- avanzamento ---
        self.progress_bar = ctk.CTkProgressBar(pagina, height=4, corner_radius=2,
                                               progress_color=BLU, fg_color=COLORE_PULSANTE)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=6, column=0, sticky="ew")

        riga_stato = ctk.CTkFrame(pagina, fg_color="transparent")
        riga_stato.grid(row=7, column=0, sticky="ew", pady=(4, 14))
        riga_stato.grid_columnconfigure(0, weight=1)

        self.lbl_details = ctk.CTkLabel(riga_stato, text="Pronto", font=self._font(12),
                                        text_color=COLORE_GRIGIO, anchor="w", height=18)
        self.lbl_details.grid(row=0, column=0, sticky="w")
        self.lbl_percentage = ctk.CTkLabel(riga_stato, text="", font=self._font(12),
                                           text_color=COLORE_GRIGIO, anchor="e", height=18)
        self.lbl_percentage.grid(row=0, column=1, sticky="e")

        # --- pulsanti ---
        self.btn_start = ctk.CTkButton(
            pagina, text="Avvia", font=self._font(14, bold=True), height=36, corner_radius=8,
            fg_color=BLU, hover_color=BLU_HOVER, text_color="#ffffff", command=self._click_avvia
        )
        self.btn_start.grid(row=8, column=0, sticky="ew")

        # "Apri video" compare solo quando il video è pronto
        self.btn_apri = self._pulsante_grigio(pagina, "Apri video",
                                              lambda: self._apri_file(self._output_path))
        self.btn_apri.configure(height=30)
        self.btn_apri.grid(row=9, column=0, sticky="ew", pady=(8, 0))
        self.btn_apri.grid_remove()

        # --- dettagli (log), nascosti finché non servono ---
        self.lbl_dettagli = ctk.CTkLabel(pagina, text="▸ Mostra dettagli", font=self._font(12),
                                         text_color=COLORE_GRIGIO, cursor="hand2", anchor="w")
        self.lbl_dettagli.grid(row=10, column=0, sticky="w", pady=(10, 0))
        self.lbl_dettagli.bind("<Button-1>", lambda e: self._mostra_nascondi_log())

        self.txt_log = ctk.CTkTextbox(pagina, height=120, corner_radius=8, fg_color=COLORE_SCHEDA,
                                      text_color=COLORE_TESTO, font=ctk.CTkFont(family="Menlo", size=11))
        self.txt_log.grid(row=11, column=0, sticky="ew", pady=(6, 0))
        self.txt_log.grid_remove()

    # ---------- grafica con tkinter puro (se manca CustomTkinter) ----------

    def _build_standard_ui(self):
        pagina = ttk.Frame(self.root, padding=(24, 20, 24, 22))
        pagina.pack(fill=tk.BOTH, expand=True)
        pagina.grid_columnconfigure(0, weight=1)

        ttk.Label(pagina, text="Velocità", font=(FONT_SISTEMA, 24, "bold")).grid(row=0, column=0, sticky="w")
        ttk.Label(pagina, text="Nasconde il numero della velocità nei video della moto.",
                  foreground="gray").grid(row=1, column=0, sticky="w", pady=(0, 14))

        scheda_file = ttk.LabelFrame(pagina, text="File", padding=8)
        scheda_file.grid(row=2, column=0, sticky="ew", pady=(0, 12))
        scheda_file.grid_columnconfigure(1, weight=1)

        ttk.Label(scheda_file, text="Video").grid(row=0, column=0, sticky="w")
        self.lbl_video = ttk.Label(scheda_file, text="Nessun file", foreground="gray", width=30, anchor="e")
        self.lbl_video.grid(row=0, column=1, sticky="e", padx=8)
        ttk.Button(scheda_file, text="Scegli…", command=self._select_input).grid(row=0, column=2, pady=3)

        ttk.Label(scheda_file, text="Salva in").grid(row=1, column=0, sticky="w")
        self.lbl_cartella = ttk.Label(scheda_file, text="Accanto al video", foreground="gray", width=30, anchor="e")
        self.lbl_cartella.grid(row=1, column=1, sticky="e", padx=8)
        ttk.Button(scheda_file, text="Cambia…", command=self._select_output).grid(row=1, column=2, pady=3)

        scheda_opzioni = ttk.LabelFrame(pagina, text="Opzioni", padding=8)
        scheda_opzioni.grid(row=3, column=0, sticky="ew", pady=(0, 14))
        scheda_opzioni.grid_columnconfigure(1, weight=1)

        self.debug_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(scheda_opzioni, text="Mostra i riquadri (prova)",
                        variable=self.debug_var).grid(row=0, column=0, columnspan=3, sticky="w", pady=3)

        ttk.Label(scheda_opzioni, text="Uso CPU").grid(row=1, column=0, sticky="w")
        ttk.Combobox(scheda_opzioni, textvariable=self.opzione_cpu_var,
                     values=list(PERCENTUALI_CPU_WORKERS.keys()), state="readonly", width=8
                     ).grid(row=1, column=2, sticky="e", pady=3)

        self.progress_bar = ttk.Progressbar(pagina, orient="horizontal", mode="determinate")
        self.progress_bar.grid(row=4, column=0, sticky="ew")

        riga_stato = ttk.Frame(pagina)
        riga_stato.grid(row=5, column=0, sticky="ew", pady=(4, 12))
        riga_stato.grid_columnconfigure(0, weight=1)
        self.lbl_details = ttk.Label(riga_stato, text="Pronto", foreground="gray")
        self.lbl_details.grid(row=0, column=0, sticky="w")
        self.lbl_percentage = ttk.Label(riga_stato, text="", foreground="gray")
        self.lbl_percentage.grid(row=0, column=1, sticky="e")

        self.btn_start = ttk.Button(pagina, text="Avvia", command=self._click_avvia)
        self.btn_start.grid(row=6, column=0, sticky="ew", ipady=4)

        self.btn_apri = ttk.Button(pagina, text="Apri video", command=lambda: self._apri_file(self._output_path))
        self.btn_apri.grid(row=7, column=0, sticky="ew", pady=(8, 0))
        self.btn_apri.grid_remove()

        self.lbl_dettagli = ttk.Label(pagina, text="▸ Mostra dettagli", foreground="gray", cursor="hand2")
        self.lbl_dettagli.grid(row=8, column=0, sticky="w", pady=(10, 0))
        self.lbl_dettagli.bind("<Button-1>", lambda e: self._mostra_nascondi_log())

        self.txt_log = tk.Text(pagina, height=7, width=60, relief="flat")
        self.txt_log.grid(row=9, column=0, sticky="ew", pady=(6, 0))
        self.txt_log.grid_remove()

    # ---------- dettagli (log) ----------

    def _mostra_nascondi_log(self):
        if self._log_visibile:
            self.txt_log.grid_remove()
            self.lbl_dettagli.configure(text="▸ Mostra dettagli")
        else:
            self.txt_log.grid()
            self.lbl_dettagli.configure(text="▾ Nascondi dettagli")
        self._log_visibile = not self._log_visibile

    # ---------- scelta file e cartella ----------

    def _select_input(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("Media Files", "*.mp4 *.mov *.avi *.mkv *.jpg *.jpeg *.png *.webp")]
        )
        if file_path:
            self.input_path = file_path
            self.lbl_video.configure(text=os.path.basename(file_path))

            if not self.output_dir:
                self.output_dir = os.path.dirname(file_path)
                self.lbl_cartella.configure(text=os.path.basename(self.output_dir) or self.output_dir)

    def _select_output(self):
        folder_path = filedialog.askdirectory()
        if folder_path:
            self.output_dir = folder_path
            self.lbl_cartella.configure(text=os.path.basename(folder_path) or folder_path)

    # ---------- comunicazione tra thread e finestra ----------

    def _in_gui(self, funzione, *argomenti):
        """Chiamata dal thread di elaborazione: chiede alla finestra di
        eseguire funzione(*argomenti) appena può."""
        self._coda.put((funzione, argomenti))

    def _controlla_coda(self):
        # Gira nella finestra ogni 100 ms ed esegue le richieste arrivate.
        # (Prima il thread usava root.after(), ma chiamato da un altro
        # thread a volte non arriva mai: la barra restava ferma.)
        while not self._coda.empty():
            funzione, argomenti = self._coda.get()
            funzione(*argomenti)
        try:
            self.root.after(100, self._controlla_coda)
        except tk.TclError:
            pass  # la finestra è stata chiusa

    def log(self, message):
        # Il thread di elaborazione non può toccare la GUI direttamente
        # (tkinter non lo permette e a volte si blocca o va in crash):
        # chiede alla finestra di scrivere lei il messaggio appena può.
        self._in_gui(self._scrivi_log, message)

    def _scrivi_log(self, message):
        self.txt_log.insert(tk.END, message + "\n")
        self.txt_log.see(tk.END)
        # se c'è un errore apre da solo i dettagli, così si vede subito
        if message.startswith("[ERRORE]") and not self._log_visibile:
            self._mostra_nascondi_log()

    # ---------- link per aprire il video finale ----------

    def _apri_file(self, path):
        if not path or not os.path.exists(path):
            return
        try:
            if sys.platform == "darwin":
                subprocess.run(["open", path])
            elif sys.platform.startswith("win"):
                os.startfile(path)  # type: ignore[attr-defined]
            else:
                subprocess.run(["xdg-open", path])
        except Exception as e:
            messagebox.showerror("Errore", f"Impossibile aprire il file: {e}")

    # ---------- chiusura del programma ----------

    def _esci(self):
        if self._elaborazione_in_corso:
            conferma = messagebox.askyesno(
                "Conferma uscita",
                "C'è un'elaborazione in corso.\n"
                "Uscire comunque interrompe subito il processo e il video "
                "risulterà incompleto/mancante.\n\nUscire lo stesso?"
            )
            if not conferma:
                return
            self._stop_event.set()
            # da' un attimo al thread di elaborazione per rilasciare
            # file video e uscire in modo pulito prima di chiudere la GUI
            self.root.after(300, self._chiudi_finestra)
        else:
            self._chiudi_finestra()

    def _chiudi_finestra(self):
        self.root.quit()
        self.root.destroy()

    def _click_avvia(self):
        # lo stesso pulsante fa "Avvia" e, mentre lavora, "Interrompi"
        if self._elaborazione_in_corso:
            self._stop_event.set()
            self.btn_start.configure(state="disabled")
            self.lbl_details.configure(text="Interruzione…")
        else:
            self._start_thread()

    def _start_thread(self):
        in_p = self.input_path
        out_p = self.output_dir

        if not os.path.isfile(in_p):
            messagebox.showerror("Errore", "Selezionare un file di input valido.")
            return

        # Se la cartella di destinazione è vuota, salva accanto al file di
        # input (prima finiva nella cartella da cui era partito il programma).
        if out_p.strip() == "":
            out_p = os.path.dirname(os.path.abspath(in_p))
            self.output_dir = out_p
            self.lbl_cartella.configure(text=os.path.basename(out_p) or out_p)

        # Se la cartella non esiste il video non veniva salvato, ma il
        # programma diceva lo stesso "Completato con successo".
        if not os.path.isdir(out_p):
            messagebox.showerror("Errore", "La cartella di destinazione non esiste.")
            return

        debug = self.switch_debug.get() == 1 if USE_CTK else self.debug_var.get()

        self._update_progress(0, "Avvio…")
        self.btn_apri.grid_remove()
        self.btn_start.configure(text="Interrompi")
        if USE_CTK:
            # mentre lavora il pulsante diventa grigio
            self.btn_start.configure(fg_color=COLORE_PULSANTE, hover_color=COLORE_PULSANTE_HOVER,
                                     text_color=COLORE_TESTO)

        self._output_path = ""
        self._stop_event.clear()
        self._elaborazione_in_corso = True

        t = threading.Thread(target=self._process, args=(in_p, out_p, debug))
        t.daemon = True
        t.start()

    def _process(self, in_file, out_dir, debug):
        # messaggio mostrato alla fine sotto la barra (cambia se c'è un errore)
        self._messaggio_finale = "Elaborazione completata."
        try:
            filename = os.path.basename(in_file)
            name, ext = os.path.splitext(filename)

            self.log(f"[+] Elaborazione file: {filename} [Debug: {debug}]")

            # Le foto (jpg, png, webp) si possono scegliere nel file picker:
            # prima venivano trasformate in un video .mp4 di un solo frame,
            # adesso vengono salvate come foto.
            if ext.lower() in ESTENSIONI_IMMAGINI:
                self._elabora_immagine(in_file, out_dir, name, ext, debug)
                return

            cap = cv2.VideoCapture(in_file)
            if not cap.isOpened():
                raise ValueError("Impossibile aprire il file video.")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            cap.release()

            temp_out = os.path.join(out_dir, f"temp_{name}.mp4")
            final_out = os.path.join(out_dir, f"{name}_speed_blur.mp4")

            ffmpeg_bin = trova_ffmpeg()

            opzione_scelta = self.opzione_cpu_var.get()
            percentuale = PERCENTUALI_CPU_WORKERS.get(opzione_scelta, 0.50)
            worker_richiesti = calcola_numero_worker(percentuale)
            # non creare più worker di quanti ne servano davvero per la
            # lunghezza del video (niente processi per pochi fotogrammi)
            n_worker = min(worker_richiesti, max(1, total_frames // FRAME_MINIMI_PER_PROCESSO))

            self.log(f"[+] CPU disponibili: {CPU_TOTALI} — Worker utilizzati: {n_worker} "
                      f"(impostazione: {opzione_scelta})")

            if ffmpeg_bin and total_frames > 0 and n_worker > 1:
                interrotto = not self._elabora_parallelo(
                    in_file, temp_out, total_frames, fps, frame_w, frame_h, debug, n_worker
                )
            else:
                self.log("[+] Elaborazione sequenziale (video corto o ffmpeg non trovato)...")
                interrotto = not self._elabora_sequenziale(
                    in_file, temp_out, total_frames, fps, frame_w, frame_h, debug
                )

            if interrotto:
                self.log("[!] Elaborazione interrotta dall'utente.")
                self._messaggio_finale = "Elaborazione interrotta."
                if os.path.exists(temp_out):
                    os.remove(temp_out)
                return

            if not os.path.exists(temp_out):
                raise ValueError("Il video elaborato non è stato creato.")

            self.log("[+] Sincronizzazione audio in corso...")
            self._in_gui(self._update_progress, 1.0, "Sincronizzazione audio in corso...")

            if ffmpeg_bin:
                cmd = [
                    ffmpeg_bin, "-y",
                    "-i", temp_out,
                    "-i", in_file,
                    "-c:v", "copy",
                    "-c:a", "aac",
                    "-map", "0:v:0",
                    "-map", "1:a:0?",
                    final_out
                ]
                risultato = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if risultato.returncode == 0 and os.path.exists(final_out):
                    os.remove(temp_out)
                else:
                    # Prima, se ffmpeg falliva, il video elaborato veniva
                    # cancellato lo stesso e si perdeva tutto: ora si tiene
                    # almeno il video senza audio.
                    self.log("[!] Audio non aggiunto (errore di ffmpeg): salvo il video senza audio.")
                    if os.path.exists(final_out):
                        os.remove(final_out)
                    os.rename(temp_out, final_out)
            else:
                self.log("[!] ffmpeg non trovato: il video sarà senza audio.")
                if os.path.exists(final_out):
                    os.remove(final_out)
                os.rename(temp_out, final_out)

            self._output_path = final_out
            self.log(f"[✓] Completato con successo! Salvato in: {final_out}")

        except Exception as e:
            self.log(f"[ERRORE] {str(e)}")
            self._messaggio_finale = "Errore: guarda il log qui sotto."
        finally:
            self._elaborazione_in_corso = False
            self._in_gui(self._reset_ui)

    def _elabora_immagine(self, in_file, out_dir, name, ext, debug):
        """Pixella il display in una singola foto e la salva con lo stesso formato."""
        # np.fromfile + imdecode invece di cv2.imread: cv2.imread su Windows
        # non riesce ad aprire file con lettere accentate nel percorso.
        dati = np.fromfile(in_file, dtype=np.uint8)
        frame = cv2.imdecode(dati, cv2.IMREAD_COLOR)
        if frame is None:
            raise ValueError("Impossibile aprire l'immagine.")

        processor = SpeedDisplayProcessor(debug=debug)
        risultato = processor.process_frame(frame)

        final_out = os.path.join(out_dir, f"{name}_speed_blur{ext}")
        ok, codificata = cv2.imencode(ext, risultato)
        if not ok:
            raise ValueError("Impossibile salvare l'immagine.")
        codificata.tofile(final_out)

        self._in_gui(self._update_progress, 1.0, "Foto elaborata.")
        self._output_path = final_out
        self.log(f"[✓] Completato con successo! Salvato in: {final_out}")

    def _elabora_sequenziale(self, in_file, temp_out, total_frames, fps, frame_w, frame_h, debug):
        """Percorso "classico", un solo processo. Ritorna False se interrotto dall'utente."""
        processor = SpeedDisplayProcessor(debug=debug)
        cap = cv2.VideoCapture(in_file)

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(temp_out, fourcc, fps, (frame_w, frame_h))
        if not out.isOpened():
            cap.release()
            raise ValueError("Impossibile creare il video di output (controlla la cartella).")

        count = 0
        start_time = time.time()

        while cap.isOpened():
            if self._stop_event.is_set():
                cap.release()
                out.release()
                return False

            ret, frame = cap.read()
            if not ret:
                break

            processed_frame = processor.process_frame(frame)
            out.write(processed_frame)

            count += 1
            if total_frames > 0:
                pct = count / total_frames
                elapsed = time.time() - start_time
                frames_left = total_frames - count
                if count > 5 and elapsed > 0:
                    fps_proc = count / elapsed
                    eta_seconds = frames_left / fps_proc if fps_proc > 0 else 0
                    eta_str = formatta_tempo(eta_seconds)
                else:
                    eta_str = "…"
                details_text = f"Elaborazione… mancano {eta_str}"
                self._in_gui(self._update_progress, pct, details_text)

        cap.release()
        out.release()
        return True

    def _elabora_parallelo(self, in_file, temp_out, total_frames, fps, frame_w, frame_h, debug, n_worker):
        """
        Divide il video in n_worker pezzi ed elabora ognuno in un processo
        separato (sfrutta più core della CPU), poi riunisce i pezzi con
        ffmpeg. Ritorna False se interrotto dall'utente.
        """
        base = total_frames // n_worker
        confini = [base * i for i in range(n_worker)] + [total_frames]

        temp_dir = tempfile.mkdtemp(prefix="speedblur_")
        segmenti = []
        processi = []
        contatori = []  # (Value, num_frame_del_pezzo)

        try:
            for i in range(n_worker):
                start = confini[i]
                fine = confini[i + 1]
                if start >= fine:
                    continue

                seg_path = os.path.join(temp_dir, f"seg_{i:03d}.mp4")
                contatore = mp.Value('i', 0)

                p = mp.Process(
                    target=_elabora_segmento,
                    args=(in_file, start, fine - start, debug, seg_path, fps, frame_w, frame_h, contatore)
                )
                p.start()

                processi.append(p)
                segmenti.append(seg_path)
                contatori.append((contatore, fine - start))

            start_time = time.time()
            while any(p.is_alive() for p in processi):
                if self._stop_event.is_set():
                    for p in processi:
                        p.terminate()
                    for p in processi:
                        p.join()
                    return False

                fatti = sum(c.value for c, _ in contatori)
                if total_frames > 0:
                    pct = fatti / total_frames
                    elapsed = time.time() - start_time
                    frames_left = total_frames - fatti
                    if fatti > 5 and elapsed > 0:
                        fps_proc = fatti / elapsed
                        eta_seconds = frames_left / fps_proc if fps_proc > 0 else 0
                        eta_str = formatta_tempo(eta_seconds)
                    else:
                        eta_str = "…"
                    details_text = f"Elaborazione… mancano {eta_str}"
                    self._in_gui(self._update_progress, pct, details_text)

                time.sleep(0.2)

            for p in processi:
                p.join()

            if self._stop_event.is_set():
                return False

            # Se un processo si è chiuso con un errore, il suo pezzo di
            # video manca o è incompleto: meglio fermarsi che salvare un
            # video con un buco in mezzo.
            for i, p in enumerate(processi):
                if p.exitcode != 0 or not os.path.exists(segmenti[i]):
                    raise ValueError(f"Il pezzo {i + 1} del video non è stato elaborato.")

            # riunisce i pezzi in un unico file, nell'ordine giusto
            elenco_path = os.path.join(temp_dir, "elenco.txt")
            with open(elenco_path, "w") as f:
                for s in segmenti:
                    f.write(f"file '{s}'\n")

            ffmpeg_bin = trova_ffmpeg()
            cmd = [ffmpeg_bin, "-y", "-f", "concat", "-safe", "0", "-i", elenco_path, "-c", "copy", temp_out]
            risultato = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if risultato.returncode != 0:
                raise ValueError("ffmpeg non è riuscito a unire i pezzi del video.")

            return True
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _update_progress(self, pct, details_text):
        if USE_CTK:
            self.progress_bar.set(pct)
        else:
            self.progress_bar['value'] = pct * 100
        self.lbl_percentage.configure(text=f"{int(pct * 100)}%")
        self.lbl_details.configure(text=details_text)

    def _reset_ui(self):
        # prima diceva sempre "completata", anche dopo un errore o uno stop
        messaggio = getattr(self, "_messaggio_finale", "Elaborazione completata.")
        self.lbl_details.configure(text=messaggio)
        self.btn_start.configure(text="Avvia", state="normal")
        if USE_CTK:
            self.btn_start.configure(fg_color=BLU, hover_color=BLU_HOVER, text_color="#ffffff")
        if self._output_path:
            _, ext = os.path.splitext(self._output_path)
            if ext.lower() in ESTENSIONI_IMMAGINI:
                self.btn_apri.configure(text="Apri foto")
            else:
                self.btn_apri.configure(text="Apri video")
            self.btn_apri.grid()


if __name__ == "__main__":
    mp.freeze_support()

    if USE_CTK:
        root = ctk.CTk()
    else:
        root = tk.Tk()

    app = ModernSpeedometerApp(root)
    root.mainloop()