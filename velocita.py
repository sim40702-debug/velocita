import os
import sys
import cv2
import numpy as np
import subprocess
import shutil
import time
import math
import threading
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
    "AUTO": 0.50,
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
# SPINNER "LIQUID GLASS" (canvas, rotazione fluida)
# ==========================================

SPINNER_PUNTI = 16          # quanti punti compongono l'anello
SPINNER_RAGGIO = 24         # raggio dell'anello (px)
SPINNER_DOT_R = 3.4         # raggio dei singoli punti (px)
SPINNER_CANVAS_SIZE = 64
SPINNER_INTERVALLO_MS = 45  # più basso = rotazione più veloce/fluida

# Palette "liquid glass": blu vetro luminoso che sfuma nel translucido scuro
SPINNER_COLORE_TESTA = (140, 200, 255)   # blu chiaro brillante (capo scia)
SPINNER_COLORE_CODA = (45, 58, 74)       # blu-grigio scuro translucido
SPINNER_SFONDO = "#242424"               # deve avvicinarsi allo sfondo del frame scuro


def _blend_hex(rgb1, rgb2, t):
    """Interpola linearmente tra due colori RGB (t da 0 a 1) e restituisce hex."""
    r = int(rgb1[0] + (rgb2[0] - rgb1[0]) * t)
    g = int(rgb1[1] + (rgb2[1] - rgb1[1]) * t)
    b = int(rgb1[2] + (rgb2[2] - rgb1[2]) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


class SpinnerLiquidGlass:
    """Anello di punti che ruota con una scia luminosa, disegnato su un
    tk.Canvas (funziona sia dentro widget CustomTkinter che tkinter puro)."""

    def __init__(self, parent):
        self.canvas = tk.Canvas(
            parent, width=SPINNER_CANVAS_SIZE, height=SPINNER_CANVAS_SIZE,
            highlightthickness=0, bg=SPINNER_SFONDO
        )
        self._dot_ids = []
        self._head = 0
        self._job = None

        cx = cy = SPINNER_CANVAS_SIZE / 2
        for i in range(SPINNER_PUNTI):
            angolo = 2 * math.pi * i / SPINNER_PUNTI
            x = cx + SPINNER_RAGGIO * math.cos(angolo)
            y = cy + SPINNER_RAGGIO * math.sin(angolo)
            dot = self.canvas.create_oval(
                x - SPINNER_DOT_R, y - SPINNER_DOT_R,
                x + SPINNER_DOT_R, y + SPINNER_DOT_R,
                fill=SPINNER_SFONDO, outline=""
            )
            self._dot_ids.append(dot)

    def grid(self, **kwargs):
        self.canvas.grid(**kwargs)

    def pack(self, **kwargs):
        self.canvas.pack(**kwargs)

    def _disegna_frame(self):
        for i, dot in enumerate(self._dot_ids):
            distanza = (self._head - i) % SPINNER_PUNTI
            # scia luminosa: più vicino alla "testa", più luminoso
            t = 1 - (distanza / SPINNER_PUNTI)
            t = max(0.0, t) ** 1.6  # curva morbida, stile "liquid glass"
            colore = _blend_hex(SPINNER_COLORE_CODA, SPINNER_COLORE_TESTA, t)
            self.canvas.itemconfig(dot, fill=colore)

    def avvia(self):
        self._head = (self._head + 1) % SPINNER_PUNTI
        self._disegna_frame()
        self._job = self.canvas.after(SPINNER_INTERVALLO_MS, self.avvia)

    def ferma(self):
        if self._job is not None:
            self.canvas.after_cancel(self._job)
            self._job = None
        for dot in self._dot_ids:
            self.canvas.itemconfig(dot, fill=SPINNER_SFONDO)


# ==========================================
# INTERFACCIA GRAFICA (GUI)
# ==========================================

class ModernSpeedometerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Auto-Tracker Dashboard Engine (Speed Blur)")
        self.root.geometry("800x760")

        self.input_path = ""
        self.output_dir = ""
        self._output_path = ""
        self._elaborazione_in_corso = False
        self._stop_event = threading.Event()

        self._build_gui()
        self.root.protocol("WM_DELETE_WINDOW", self._esci)

    def _build_gui(self):
        # variabile condivisa dalle due UI per la scelta "CPU Workers"
        if USE_CTK:
            self.opzione_cpu_var = ctk.StringVar(value="AUTO")
            self._build_customtkinter_ui()
        else:
            self.opzione_cpu_var = tk.StringVar(value="AUTO")
            self._build_standard_ui()

    def _build_customtkinter_ui(self):
        self.root.grid_columnconfigure(0, weight=1)

        header = ctk.CTkFrame(self.root, corner_radius=10)
        header.grid(row=0, column=0, padx=15, pady=10, sticky="ew")
        ctk.CTkLabel(header, text="🎯 Speed Display Blur (SWM 125 R)", font=ctk.CTkFont(size=18, weight="bold")).pack(padx=15, pady=10)

        file_frame = ctk.CTkFrame(self.root, corner_radius=10)
        file_frame.grid(row=1, column=0, padx=15, pady=5, sticky="ew")

        self.entry_input = ctk.CTkEntry(file_frame, placeholder_text="Seleziona File Video...", width=500)
        self.entry_input.grid(row=0, column=0, padx=10, pady=10)
        ctk.CTkButton(file_frame, text="Sfoglia File", command=self._select_input).grid(row=0, column=1, padx=10, pady=10)

        self.entry_output = ctk.CTkEntry(file_frame, placeholder_text="Cartella Destinazione...", width=500)
        self.entry_output.grid(row=1, column=0, padx=10, pady=10)
        ctk.CTkButton(file_frame, text="Sfoglia Cartella", command=self._select_output).grid(row=1, column=1, padx=10, pady=10)

        params_frame = ctk.CTkFrame(self.root, corner_radius=10)
        params_frame.grid(row=2, column=0, padx=15, pady=10, sticky="ew")

        self.switch_debug = ctk.CTkSwitch(params_frame, text="Debug Visivo (verde=zona rilevata, rosso=zona sfuocata, nessun effetto reale)")
        self.switch_debug.grid(row=0, column=0, padx=15, pady=10, sticky="w")

        cpu_row = ctk.CTkFrame(params_frame, fg_color="transparent")
        cpu_row.grid(row=1, column=0, padx=15, pady=(0, 10), sticky="w")

        ctk.CTkLabel(cpu_row, text="CPU Workers:").pack(side="left", padx=(0, 8))
        ctk.CTkOptionMenu(
            cpu_row, variable=self.opzione_cpu_var,
            values=list(PERCENTUALI_CPU_WORKERS.keys()), width=110
        ).pack(side="left")
        ctk.CTkLabel(
            cpu_row, text=f"(CPU disponibili: {CPU_TOTALI})",
            font=ctk.CTkFont(size=11), text_color="gray"
        ).pack(side="left", padx=(10, 0))

        progress_frame = ctk.CTkFrame(self.root, corner_radius=10)
        progress_frame.grid(row=3, column=0, padx=15, pady=10, sticky="ew")
        progress_frame.grid_columnconfigure(0, weight=1)

        self.spinner = SpinnerLiquidGlass(progress_frame)
        self.spinner.grid(row=0, column=0, pady=(14, 4))

        self.progress_bar = ctk.CTkProgressBar(progress_frame, width=260, height=6)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=1, column=0, pady=(8, 4))

        self.lbl_percentage = ctk.CTkLabel(progress_frame, text="0%", font=ctk.CTkFont(size=15, weight="bold"))
        self.lbl_percentage.grid(row=2, column=0, pady=(0, 6))

        self.lbl_details = ctk.CTkLabel(progress_frame, text="Stato: In attesa di elaborazione...", font=ctk.CTkFont(size=12))
        self.lbl_details.grid(row=3, column=0, padx=10, pady=(0, 10))

        self.lbl_link = ctk.CTkLabel(
            progress_frame, text="", font=ctk.CTkFont(size=14, underline=True),
            text_color="#4aa8ff", cursor="hand2"
        )
        self.lbl_link.grid(row=4, column=0, padx=10, pady=(0, 14))
        self.lbl_link.bind("<Button-1>", lambda e: self._apri_file(self._output_path))

        azioni_frame = ctk.CTkFrame(self.root, fg_color="transparent")
        azioni_frame.grid(row=4, column=0, padx=15, pady=5, sticky="ew")
        azioni_frame.grid_columnconfigure(0, weight=3)
        azioni_frame.grid_columnconfigure(1, weight=1)

        self.btn_start = ctk.CTkButton(azioni_frame, text="► AVVIA ELABORAZIONE", font=ctk.CTkFont(size=16, weight="bold"), height=40, command=self._start_thread)
        self.btn_start.grid(row=0, column=0, padx=(0, 8), sticky="ew")

        self.btn_esci = ctk.CTkButton(
            azioni_frame, text="✕ Esci", font=ctk.CTkFont(size=14, weight="bold"), height=40,
            fg_color="#8b2f2f", hover_color="#6e2020", command=self._esci
        )
        self.btn_esci.grid(row=0, column=1, sticky="ew")

        self.txt_log = ctk.CTkTextbox(self.root, height=120)
        self.txt_log.grid(row=5, column=0, padx=15, pady=10, sticky="ew")

    def _build_standard_ui(self):
        frame = tk.Frame(self.root, padx=15, pady=15)
        frame.pack(fill=tk.BOTH, expand=True)

        tk.Label(frame, text="Speed Display Blur (SWM 125 R)", font=("Arial", 16, "bold")).pack(pady=5)

        f_inputs = tk.LabelFrame(frame, text=" File & Destinazione ")
        f_inputs.pack(fill=tk.X, pady=5)

        self.entry_input = tk.Entry(f_inputs, width=50)
        self.entry_input.grid(row=0, column=0, padx=5, pady=5)
        tk.Button(f_inputs, text="Sfoglia Input", command=self._select_input).grid(row=0, column=1, padx=5)

        self.entry_output = tk.Entry(f_inputs, width=50)
        self.entry_output.grid(row=1, column=0, padx=5, pady=5)
        tk.Button(f_inputs, text="Sfoglia Output", command=self._select_output).grid(row=1, column=1, padx=5)

        f_opts = tk.LabelFrame(frame, text=" Opzioni ")
        f_opts.pack(fill=tk.X, pady=5)

        self.debug_var = tk.BooleanVar(value=False)
        tk.Checkbutton(f_opts, text="Debug Visivo (verde=zona rilevata, rosso=zona sfuocata, nessun effetto reale)", variable=self.debug_var).pack(anchor="w", padx=10, pady=5)

        cpu_row = tk.Frame(f_opts)
        cpu_row.pack(anchor="w", padx=10, pady=(0, 5), fill=tk.X)
        tk.Label(cpu_row, text="CPU Workers:").pack(side=tk.LEFT, padx=(0, 8))
        ttk.Combobox(
            cpu_row, textvariable=self.opzione_cpu_var,
            values=list(PERCENTUALI_CPU_WORKERS.keys()), state="readonly", width=8
        ).pack(side=tk.LEFT)
        tk.Label(cpu_row, text=f"(CPU disponibili: {CPU_TOTALI})", fg="gray").pack(side=tk.LEFT, padx=(10, 0))

        f_prog = tk.Frame(frame)
        f_prog.pack(fill=tk.X, pady=10)

        self.spinner = SpinnerLiquidGlass(f_prog)
        self.spinner.pack(pady=(4, 6))

        self.progress_bar = ttk.Progressbar(f_prog, orient="horizontal", mode="determinate", length=260)
        self.progress_bar.pack(pady=(4, 4))

        self.lbl_percentage = tk.Label(f_prog, text="0%", font=("Arial", 13, "bold"))
        self.lbl_percentage.pack(pady=(0, 4))

        self.lbl_details = tk.Label(frame, text="Stato: In attesa di elaborazione...", font=("Arial", 10))
        self.lbl_details.pack(pady=2)

        self.lbl_link = tk.Label(frame, text="", fg="#2266cc", cursor="hand2", font=("Arial", 11, "underline"))
        self.lbl_link.pack(pady=(0, 6))
        self.lbl_link.bind("<Button-1>", lambda e: self._apri_file(self._output_path))

        azioni_frame = tk.Frame(frame)
        azioni_frame.pack(fill=tk.X, pady=5)

        self.btn_start = tk.Button(azioni_frame, text="AVVIA ELABORAZIONE", command=self._start_thread, font=("Arial", 11, "bold"))
        self.btn_start.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 8))

        self.btn_esci = tk.Button(
            azioni_frame, text="✕ Esci", command=self._esci, font=("Arial", 11, "bold"),
            fg="white", bg="#8b2f2f", activebackground="#6e2020", activeforeground="white"
        )
        self.btn_esci.pack(side=tk.LEFT)

        self.txt_log = tk.Text(frame, height=6, width=70)
        self.txt_log.pack(fill=tk.BOTH, expand=True, pady=5)

    def _select_input(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("Media Files", "*.mp4 *.mov *.avi *.mkv *.jpg *.jpeg *.png *.webp")]
        )
        if file_path:
            self.input_path = file_path
            self.entry_input.delete(0, tk.END)
            self.entry_input.insert(0, file_path)

            if not self.output_dir:
                self.output_dir = os.path.dirname(file_path)
                self.entry_output.delete(0, tk.END)
                self.entry_output.insert(0, self.output_dir)

    def _select_output(self):
        folder_path = filedialog.askdirectory()
        if folder_path:
            self.output_dir = folder_path
            self.entry_output.delete(0, tk.END)
            self.entry_output.insert(0, folder_path)

    def log(self, message):
        if USE_CTK:
            self.txt_log.insert(ctk.END, message + "\n")
            self.txt_log.see(ctk.END)
        else:
            self.txt_log.insert(tk.END, message + "\n")
            self.txt_log.see(tk.END)

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
        self.spinner.ferma()
        self.root.quit()
        self.root.destroy()

    def _start_thread(self):
        in_p = self.entry_input.get()
        out_p = self.entry_output.get()

        if not os.path.exists(in_p):
            messagebox.showerror("Errore", "Selezionare un file di input valido.")
            return

        debug = self.switch_debug.get() == 1 if USE_CTK else self.debug_var.get()

        if USE_CTK:
            self.btn_start.configure(state="disabled")
            self.progress_bar.set(0)
            self.lbl_percentage.configure(text="0%")
            self.lbl_details.configure(text="Avvio in corso...")
            self.lbl_link.configure(text="")
        else:
            self.btn_start.config(state="disabled")
            self.lbl_percentage.config(text="0%")
            self.lbl_details.config(text="Avvio in corso...")
            self.lbl_link.config(text="")

        self._output_path = ""
        self._stop_event.clear()
        self._elaborazione_in_corso = True
        self.spinner.avvia()

        t = threading.Thread(target=self._process, args=(in_p, out_p, debug))
        t.daemon = True
        t.start()

    def _process(self, in_file, out_dir, debug):
        try:
            filename = os.path.basename(in_file)
            name, ext = os.path.splitext(filename)

            self.log(f"[+] Elaborazione file: {filename} [Debug: {debug}]")
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

            ffmpeg_bin = shutil.which("ffmpeg")

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
                if os.path.exists(temp_out):
                    os.remove(temp_out)
                return

            self.log("[+] Sincronizzazione audio in corso...")
            self.root.after(0, self._update_progress, 1.0, "Sincronizzazione audio in corso...")

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
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if os.path.exists(temp_out):
                    os.remove(temp_out)
            else:
                if os.path.exists(final_out):
                    os.remove(final_out)
                os.rename(temp_out, final_out)

            self._output_path = final_out
            self.log(f"[✓] Completato con successo! Salvato in: {final_out}")

        except Exception as e:
            self.log(f"[ERRORE] {str(e)}")
        finally:
            self._elaborazione_in_corso = False
            try:
                self.root.after(0, self._reset_ui)
            except tk.TclError:
                pass  # la finestra è già stata chiusa (uscita forzata)

    def _elabora_sequenziale(self, in_file, temp_out, total_frames, fps, frame_w, frame_h, debug):
        """Percorso "classico", un solo processo. Ritorna False se interrotto dall'utente."""
        processor = SpeedDisplayProcessor(debug=debug)
        cap = cv2.VideoCapture(in_file)

        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(temp_out, fourcc, fps, (frame_w, frame_h))

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
                    eta_str = time.strftime('%M:%S', time.gmtime(eta_seconds))
                else:
                    eta_str = "Calcolo..."
                details_text = f"Mancanti: {frames_left} frame | Tempo stimato (ETA): {eta_str}"
                self.root.after(0, self._update_progress, pct, details_text)

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
                        eta_str = time.strftime('%M:%S', time.gmtime(eta_seconds))
                    else:
                        eta_str = "Calcolo..."
                    details_text = f"Mancanti: {frames_left} frame | Tempo stimato (ETA): {eta_str}"
                    self.root.after(0, self._update_progress, pct, details_text)

                time.sleep(0.2)

            for p in processi:
                p.join()

            if self._stop_event.is_set():
                return False

            # riunisce i pezzi in un unico file, nell'ordine giusto
            elenco_path = os.path.join(temp_dir, "elenco.txt")
            with open(elenco_path, "w") as f:
                for s in segmenti:
                    f.write(f"file '{s}'\n")

            ffmpeg_bin = shutil.which("ffmpeg")
            cmd = [ffmpeg_bin, "-y", "-f", "concat", "-safe", "0", "-i", elenco_path, "-c", "copy", temp_out]
            subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            return True
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    def _update_progress(self, pct, details_text):
        percent_str = f"{int(pct * 100)}%"
        if USE_CTK:
            self.progress_bar.set(pct)
            self.lbl_percentage.configure(text=percent_str)
            self.lbl_details.configure(text=details_text)
        else:
            self.progress_bar['value'] = pct * 100
            self.lbl_percentage.config(text=percent_str)
            self.lbl_details.config(text=details_text)

    def _reset_ui(self):
        self.spinner.ferma()
        if USE_CTK:
            self.btn_start.configure(state="normal")
            self.lbl_details.configure(text="Elaborazione completata.")
            if self._output_path:
                self.lbl_link.configure(text="▶ Apri il video elaborato")
        else:
            self.btn_start.config(state="normal")
            self.lbl_details.config(text="Elaborazione completata.")
            if self._output_path:
                self.lbl_link.config(text="▶ Apri il video elaborato")


if __name__ == "__main__":
    mp.freeze_support()

    if USE_CTK:
        root = ctk.CTk()
    else:
        root = tk.Tk()

    app = ModernSpeedometerApp(root)
    root.mainloop()