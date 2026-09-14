"""GUI per tachometer_blur: seleziona il video, imposta le opzioni e avvia
l'elaborazione senza usare la riga di comando. Pensato per essere impacchettato
in un .exe con PyInstaller.

UI in CustomTkinter se disponibile (dark mode, look moderno), altrimenti
fallback automatico a tkinter/ttk puro — nessuna dipendenza obbligatoria.
"""
from __future__ import annotations

import math
import os
import re
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox

try:
    import customtkinter as ctk
    USE_CTK = True
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")
except ImportError:
    from tkinter import ttk
    USE_CTK = False

from speed_reader import OCR_AVAILABLE
from video_processor import CancelledError, ProcessingError, process_video

SUPPORTED_EXTENSIONS = (".mp4", ".mov", ".mkv")
_PCT_RE = re.compile(r"^(\d+)%")


# ==========================================
# SPINNER "LIQUID GLASS" (canvas, rotazione fluida)
# ==========================================

_SPINNER_PUNTI = 16
_SPINNER_RAGGIO = 22
_SPINNER_DOT_R = 3.2
_SPINNER_CANVAS_SIZE = 58
_SPINNER_INTERVALLO_MS = 45
_SPINNER_TESTA = (140, 200, 255)
_SPINNER_CODA = (45, 58, 74)
_SPINNER_SFONDO = "#242424" if USE_CTK else "#f0f0f0"


def _blend_hex(rgb1, rgb2, t):
    r = int(rgb1[0] + (rgb2[0] - rgb1[0]) * t)
    g = int(rgb1[1] + (rgb2[1] - rgb1[1]) * t)
    b = int(rgb1[2] + (rgb2[2] - rgb1[2]) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


class SpinnerLiquidGlass:
    """Anello di punti che ruota con una scia luminosa, per segnalare
    un'elaborazione in corso senza il costo di un vero indicatore animato."""

    def __init__(self, parent, bg=_SPINNER_SFONDO):
        self.canvas = tk.Canvas(parent, width=_SPINNER_CANVAS_SIZE, height=_SPINNER_CANVAS_SIZE,
                                 highlightthickness=0, bg=bg)
        self._bg = bg
        self._dot_ids = []
        self._head = 0
        self._job = None

        cx = cy = _SPINNER_CANVAS_SIZE / 2
        for i in range(_SPINNER_PUNTI):
            angolo = 2 * math.pi * i / _SPINNER_PUNTI
            x = cx + _SPINNER_RAGGIO * math.cos(angolo)
            y = cy + _SPINNER_RAGGIO * math.sin(angolo)
            dot = self.canvas.create_oval(x - _SPINNER_DOT_R, y - _SPINNER_DOT_R,
                                           x + _SPINNER_DOT_R, y + _SPINNER_DOT_R,
                                           fill=bg, outline="")
            self._dot_ids.append(dot)

    def grid(self, **kwargs):
        self.canvas.grid(**kwargs)

    def _disegna_frame(self):
        for i, dot in enumerate(self._dot_ids):
            distanza = (self._head - i) % _SPINNER_PUNTI
            t = max(0.0, 1 - distanza / _SPINNER_PUNTI) ** 1.6
            self.canvas.itemconfig(dot, fill=_blend_hex(_SPINNER_CODA, _SPINNER_TESTA, t))

    def avvia(self):
        self._head = (self._head + 1) % _SPINNER_PUNTI
        self._disegna_frame()
        self._job = self.canvas.after(_SPINNER_INTERVALLO_MS, self.avvia)

    def ferma(self):
        if self._job is not None:
            self.canvas.after_cancel(self._job)
            self._job = None
        for dot in self._dot_ids:
            self.canvas.itemconfig(dot, fill=self._bg)


# ==========================================
# GUI PRINCIPALE
# ==========================================

class App:
    def __init__(self, root):
        self.root = root
        self.root.title("Tachometer Blur")
        self.root.geometry("640x640")
        if not USE_CTK:
            self.root.minsize(640, 580)

        self.input_path = tk.StringVar()
        self.output_path = tk.StringVar()
        self.mode = tk.StringVar(value="auto")
        self.tracker_kind = tk.StringVar(value="kcf")
        self.pixelate_block = tk.IntVar(value=12)
        self.preview_seconds = tk.DoubleVar(value=0)
        self.min_speed = tk.IntVar(value=0)
        self.cancel_event = threading.Event()
        self._start_time = 0.0
        self._output_path = ""
        self._processing = False

        self._build_ctk() if USE_CTK else self._build_ttk()
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

    # ---------- UI: CustomTkinter ----------

    def _build_ctk(self) -> None:
        self.root.grid_columnconfigure(0, weight=1)

        header = ctk.CTkFrame(self.root, corner_radius=10)
        header.grid(row=0, column=0, padx=15, pady=(15, 10), sticky="ew")
        ctk.CTkLabel(header, text="🏍️ Tachometer Blur", font=ctk.CTkFont(size=18, weight="bold")).pack(padx=15, pady=10)

        f_files = ctk.CTkFrame(self.root, corner_radius=10)
        f_files.grid(row=1, column=0, padx=15, pady=5, sticky="ew")
        f_files.grid_columnconfigure(0, weight=1)

        self.entry_input = ctk.CTkEntry(f_files, textvariable=self.input_path, placeholder_text="Seleziona video di input...")
        self.entry_input.grid(row=0, column=0, padx=(10, 5), pady=10, sticky="ew")
        ctk.CTkButton(f_files, text="Sfoglia...", width=90, command=self._pick_input).grid(row=0, column=1, padx=(0, 10), pady=10)

        self.entry_output = ctk.CTkEntry(f_files, textvariable=self.output_path, placeholder_text="Video di output...")
        self.entry_output.grid(row=1, column=0, padx=(10, 5), pady=(0, 10), sticky="ew")
        ctk.CTkButton(f_files, text="Sfoglia...", width=90, command=self._pick_output).grid(row=1, column=1, padx=(0, 10), pady=(0, 10))

        f_opts = ctk.CTkFrame(self.root, corner_radius=10)
        f_opts.grid(row=2, column=0, padx=15, pady=10, sticky="ew")
        f_opts.grid_columnconfigure((1, 3), weight=1)

        def row(r, label1, widget1, label2=None, widget2=None):
            ctk.CTkLabel(f_opts, text=label1).grid(row=r, column=0, sticky="w", padx=(12, 6), pady=8)
            widget1.grid(row=r, column=1, sticky="ew", padx=(0, 16), pady=8)
            if label2 is not None:
                ctk.CTkLabel(f_opts, text=label2).grid(row=r, column=2, sticky="w", padx=(0, 6), pady=8)
                widget2.grid(row=r, column=3, sticky="ew", padx=(0, 12), pady=8)

        row(0, "Modalità:",
            ctk.CTkOptionMenu(f_opts, variable=self.mode, values=["auto", "manual"]),
            "Blocco pixelate:",
            ctk.CTkEntry(f_opts, textvariable=self.pixelate_block))

        row(1, "Tracker (solo manuale):",
            ctk.CTkOptionMenu(f_opts, variable=self.tracker_kind, values=["kcf", "csrt"]),
            "Preview (secondi, 0=tutto):",
            ctk.CTkEntry(f_opts, textvariable=self.preview_seconds))

        speed_label = "Oscura solo sopra (km/h, 0=sempre):"
        if not OCR_AVAILABLE:
            speed_label += " *"
        row(2, speed_label, ctk.CTkEntry(f_opts, textvariable=self.min_speed))
        if not OCR_AVAILABLE:
            ctk.CTkLabel(f_opts, text="* richiede Tesseract OCR installato (vedi README)", text_color="#888888").grid(
                row=3, column=0, columnspan=4, sticky="w", padx=12, pady=(0, 8)
            )

        f_progress = ctk.CTkFrame(self.root, corner_radius=10)
        f_progress.grid(row=3, column=0, padx=15, pady=(0, 10), sticky="ew")
        f_progress.grid_columnconfigure(0, weight=1)

        self.spinner = SpinnerLiquidGlass(f_progress)
        self.spinner.grid(row=0, column=0, pady=(12, 2))

        self.progress_bar = ctk.CTkProgressBar(f_progress, height=6)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=1, column=0, padx=40, pady=(6, 4), sticky="ew")
        self.lbl_percentage = ctk.CTkLabel(f_progress, text="0%", font=ctk.CTkFont(size=13, weight="bold"))
        self.lbl_percentage.grid(row=2, column=0, pady=(0, 2))
        self.lbl_details = ctk.CTkLabel(f_progress, text="In attesa di elaborazione...", font=ctk.CTkFont(size=11), text_color="#aaaaaa")
        self.lbl_details.grid(row=3, column=0, padx=10, pady=(0, 4))

        self.lbl_link = ctk.CTkLabel(f_progress, text="", font=ctk.CTkFont(size=13, underline=True),
                                      text_color="#4aa8ff", cursor="hand2")
        self.lbl_link.grid(row=4, column=0, padx=10, pady=(0, 12))
        self.lbl_link.bind("<Button-1>", lambda e: self._apri_file(self._output_path))

        f_actions = ctk.CTkFrame(self.root, fg_color="transparent")
        f_actions.grid(row=4, column=0, padx=15, pady=(4, 6), sticky="ew")
        f_actions.grid_columnconfigure(0, weight=3)
        f_actions.grid_columnconfigure(1, weight=1)
        f_actions.grid_columnconfigure(2, weight=1)

        self.btn_start = ctk.CTkButton(f_actions, text="► AVVIA ELABORAZIONE", font=ctk.CTkFont(size=15, weight="bold"), height=40, command=self._start)
        self.btn_start.grid(row=0, column=0, sticky="ew", padx=(0, 6))

        self.btn_stop = ctk.CTkButton(f_actions, text="Interrompi", height=40, fg_color="#a33", hover_color="#822",
                                       state="disabled", command=self._stop)
        self.btn_stop.grid(row=0, column=1, sticky="ew", padx=(0, 6))

        self.btn_exit = ctk.CTkButton(f_actions, text="✕ Esci", height=40, fg_color="#5a5a5a", hover_color="#444",
                                       command=self._on_close)
        self.btn_exit.grid(row=0, column=2, sticky="ew")

        self.root.grid_rowconfigure(5, weight=1)
        f_log = ctk.CTkFrame(self.root, corner_radius=10)
        f_log.grid(row=5, column=0, padx=15, pady=(0, 15), sticky="nsew")
        f_log.grid_columnconfigure(0, weight=1)
        f_log.grid_rowconfigure(0, weight=1)
        self.txt_log = ctk.CTkTextbox(f_log)
        self.txt_log.grid(row=0, column=0, sticky="nsew", padx=8, pady=8)

    # ---------- UI: fallback tkinter/ttk ----------

    def _build_ttk(self) -> None:
        pad = {"padx": 10, "pady": 6}

        f_files = ttk.LabelFrame(self.root, text="File")
        f_files.pack(fill="x", **pad)
        f_files.columnconfigure(0, weight=1)

        ttk.Label(f_files, text="Video di input:").grid(row=0, column=0, columnspan=2, sticky="w", padx=8, pady=(6, 0))
        ttk.Entry(f_files, textvariable=self.input_path).grid(row=1, column=0, sticky="ew", padx=(8, 4), pady=(0, 6))
        ttk.Button(f_files, text="Sfoglia...", command=self._pick_input).grid(row=1, column=1, padx=(0, 8), pady=(0, 6))

        ttk.Label(f_files, text="Video di output:").grid(row=2, column=0, columnspan=2, sticky="w", padx=8, pady=(0, 0))
        ttk.Entry(f_files, textvariable=self.output_path).grid(row=3, column=0, sticky="ew", padx=(8, 4), pady=(0, 6))
        ttk.Button(f_files, text="Sfoglia...", command=self._pick_output).grid(row=3, column=1, padx=(0, 8), pady=(0, 6))

        f_opts = ttk.LabelFrame(self.root, text="Opzioni")
        f_opts.pack(fill="x", **pad)
        f_opts.columnconfigure(1, weight=1)
        f_opts.columnconfigure(3, weight=1)

        def row(r, label1, widget1, label2=None, widget2=None):
            ttk.Label(f_opts, text=label1).grid(row=r, column=0, sticky="w", padx=(8, 4), pady=5)
            widget1.grid(row=r, column=1, sticky="ew", padx=(0, 12), pady=5)
            if label2 is not None:
                ttk.Label(f_opts, text=label2).grid(row=r, column=2, sticky="w", padx=(0, 4), pady=5)
                widget2.grid(row=r, column=3, sticky="ew", padx=(0, 8), pady=5)

        row(0, "Modalità:",
            ttk.Combobox(f_opts, textvariable=self.mode, values=["auto", "manual"], state="readonly"),
            "Blocco pixelate:",
            ttk.Spinbox(f_opts, from_=2, to=40, textvariable=self.pixelate_block))

        row(1, "Tracker (solo manuale):",
            ttk.Combobox(f_opts, textvariable=self.tracker_kind, values=["kcf", "csrt"], state="readonly"),
            "Preview (secondi, 0=intero):",
            ttk.Spinbox(f_opts, from_=0, to=600, textvariable=self.preview_seconds))

        speed_label = "Oscura solo sopra (km/h, 0=sempre):"
        if not OCR_AVAILABLE:
            speed_label += " *"
        row(2, speed_label, ttk.Spinbox(f_opts, from_=0, to=400, textvariable=self.min_speed))
        if not OCR_AVAILABLE:
            ttk.Label(f_opts, text="* richiede Tesseract OCR installato (vedi README)", foreground="#888").grid(
                row=3, column=0, columnspan=4, sticky="w", padx=8, pady=(0, 6)
            )

        f_progress = ttk.Frame(self.root)
        f_progress.pack(fill="x", padx=10, pady=(0, 6))
        f_progress.columnconfigure(0, weight=1)

        self.spinner = SpinnerLiquidGlass(f_progress)
        self.spinner.grid(row=0, column=0, columnspan=2, pady=(4, 4))

        self.progress_bar = ttk.Progressbar(f_progress, orient="horizontal", mode="determinate")
        self.progress_bar.grid(row=1, column=0, sticky="ew", padx=(0, 10))
        self.lbl_percentage = ttk.Label(f_progress, text="0%", font=("Arial", 10, "bold"), width=5)
        self.lbl_percentage.grid(row=1, column=1)
        self.lbl_details = ttk.Label(self.root, text="In attesa di elaborazione...", font=("Arial", 9))
        self.lbl_details.pack(padx=10, pady=(0, 2), anchor="w")

        self.lbl_link = tk.Label(self.root, text="", fg="#2266cc", cursor="hand2", font=("Arial", 10, "underline"))
        self.lbl_link.pack(padx=10, pady=(0, 6), anchor="w")
        self.lbl_link.bind("<Button-1>", lambda e: self._apri_file(self._output_path))

        f_actions = ttk.Frame(self.root)
        f_actions.pack(fill="x", padx=10, pady=(4, 6))
        f_actions.columnconfigure(0, weight=1)

        self.btn_start = ttk.Button(f_actions, text="Avvia elaborazione", command=self._start)
        self.btn_start.grid(row=0, column=0, sticky="ew", padx=(0, 6))

        self.btn_stop = ttk.Button(f_actions, text="Interrompi", command=self._stop, state="disabled")
        self.btn_stop.grid(row=0, column=1, sticky="ew", padx=(0, 6))

        self.btn_exit = ttk.Button(f_actions, text="Esci", command=self._on_close)
        self.btn_exit.grid(row=0, column=2, sticky="ew")

        f_log = ttk.LabelFrame(self.root, text="Log")
        f_log.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        self.txt_log = tk.Text(f_log, height=10, state="disabled")
        self.txt_log.pack(fill="both", expand=True, padx=5, pady=5)

    # ---------- azioni file ----------

    def _pick_input(self) -> None:
        path = filedialog.askopenfilename(
            title="Seleziona il video di input",
            filetypes=[("Video", "*.mp4 *.mov *.mkv"), ("Tutti i file", "*.*")],
        )
        if not path:
            return
        self.input_path.set(path)
        if not self.output_path.get():
            base, ext = os.path.splitext(path)
            self.output_path.set(f"{base}_blurred{ext or '.mp4'}")

    def _pick_output(self) -> None:
        path = filedialog.asksaveasfilename(
            title="Salva il video elaborato come...",
            defaultextension=".mp4",
            filetypes=[("MP4", "*.mp4"), ("MOV", "*.mov"), ("MKV", "*.mkv")],
        )
        if path:
            self.output_path.set(path)

    def _apri_file(self, path: str) -> None:
        if not path or not os.path.exists(path):
            return
        try:
            if sys.platform == "darwin":
                import subprocess
                subprocess.run(["open", path])
            elif sys.platform.startswith("win"):
                os.startfile(path)  # type: ignore[attr-defined]
            else:
                import subprocess
                subprocess.run(["xdg-open", path])
        except Exception as e:
            messagebox.showerror("Errore", f"Impossibile aprire il file: {e}")

    # ---------- helper UI ----------

    def _log(self, message: str) -> None:
        if USE_CTK:
            self.txt_log.insert("end", message + "\n")
            self.txt_log.see("end")
        else:
            self.txt_log.configure(state="normal")
            self.txt_log.insert("end", message + "\n")
            self.txt_log.see("end")
            self.txt_log.configure(state="disabled")

    def _set_progress(self, fraction: float, details: str) -> None:
        if USE_CTK:
            self.progress_bar.set(fraction)
            self.lbl_percentage.configure(text=f"{int(fraction * 100)}%")
            self.lbl_details.configure(text=details)
        else:
            self.progress_bar["value"] = fraction * 100
            self.lbl_percentage.config(text=f"{int(fraction * 100)}%")
            self.lbl_details.config(text=details)

    def _set_link(self, text: str) -> None:
        if USE_CTK:
            self.lbl_link.configure(text=text)
        else:
            self.lbl_link.config(text=text)

    def _set_buttons(self, running: bool) -> None:
        start_state = "disabled" if running else "normal"
        stop_state = "normal" if running else "disabled"
        if USE_CTK:
            self.btn_start.configure(state=start_state)
            self.btn_stop.configure(state=stop_state)
        else:
            self.btn_start.config(state=start_state)
            self.btn_stop.config(state=stop_state)

    # ---------- chiusura ----------

    def _on_close(self) -> None:
        if self._processing:
            conferma = messagebox.askyesno(
                "Conferma uscita",
                "C'è un'elaborazione in corso.\n"
                "Uscire comunque interrompe subito il processo e il video "
                "risulterà incompleto/mancante.\n\nUscire lo stesso?"
            )
            if not conferma:
                return
            self.cancel_event.set()
            # dà un attimo al thread di elaborazione per rilasciare il file
            # video e uscire in modo pulito prima di chiudere la GUI
            self.root.after(300, self._chiudi_finestra)
        else:
            self._chiudi_finestra()

    def _chiudi_finestra(self) -> None:
        self.spinner.ferma()
        self.root.quit()
        self.root.destroy()

    # ---------- avvio/interruzione elaborazione ----------

    def _start(self) -> None:
        in_path = self.input_path.get().strip()
        out_path = self.output_path.get().strip()

        if not in_path or not os.path.exists(in_path):
            messagebox.showerror("Errore", "Seleziona un video di input valido.")
            return
        if not in_path.lower().endswith(SUPPORTED_EXTENSIONS):
            messagebox.showerror("Errore", f"Formato non supportato (attesi: {', '.join(SUPPORTED_EXTENSIONS)}).")
            return
        if not out_path:
            messagebox.showerror("Errore", "Specifica un file di output.")
            return
        if self.min_speed.get() > 0 and not OCR_AVAILABLE:
            messagebox.showerror(
                "Errore",
                "La soglia km/h richiede pytesseract + Tesseract OCR installati "
                "(vedi README). Imposta 0 per oscurare sempre.",
            )
            return

        if self.mode.get() == "manual":
            # cv2.selectROI apre una finestra separata (non tkinter): avviso
            # esplicito, altrimenti sembra che l'app sia bloccata o non abbia
            # fatto nulla mentre in realtà sta aspettando quella finestra.
            messagebox.showinfo(
                "Seleziona il tachimetro",
                "Si aprirà una finestra con il primo frame del video.\n\n"
                "Disegna un rettangolo col mouse attorno al tachimetro, poi premi "
                "INVIO o SPAZIO per confermare (oppure C per annullare).\n\n"
                "Se la finestra non è visibile, controlla dietro le altre finestre "
                "aperte o nella barra delle applicazioni.",
            )

        self.cancel_event.clear()  # nuova elaborazione: azzera un eventuale stop precedente
        self._output_path = ""
        self._set_link("")
        self._processing = True
        self._set_buttons(running=True)
        self._set_progress(0, "Avvio in corso...")
        self.spinner.avvia()
        self._start_time = time.time()
        self._log(f"[+] Avvio elaborazione: {os.path.basename(in_path)} -> {os.path.basename(out_path)}")

        t = threading.Thread(target=self._run, args=(in_path, out_path), daemon=True)
        t.start()

    def _stop(self) -> None:
        # Segnala al thread di elaborazione di fermarsi al prossimo frame;
        # non uccide il thread a forza, così il video temporaneo viene chiuso
        # e ripulito correttamente invece di restare corrotto a metà.
        self.cancel_event.set()
        if USE_CTK:
            self.btn_stop.configure(state="disabled")
        else:
            self.btn_stop.config(state="disabled")
        self._log("[+] Interruzione richiesta, attendo la chiusura del frame corrente...")

    def _on_status(self, message: str) -> None:
        # Chiamata dal thread di elaborazione: rimbalza sul thread della GUI
        # con root.after, perché i widget grafici non sono thread-safe.
        self.root.after(0, self._handle_status, message)

    def _handle_status(self, message: str) -> None:
        self._log(f"[·] {message}")
        match = _PCT_RE.match(message)
        if match:
            self._set_progress(int(match.group(1)) / 100, message)

    def _run(self, in_path: str, out_path: str) -> None:
        try:
            process_video(
                input_path=in_path,
                output_path=out_path,
                mode=self.mode.get(),
                pixelate_block=self.pixelate_block.get(),
                tracker_kind=self.tracker_kind.get(),
                preview_seconds=self.preview_seconds.get(),
                min_speed_kmh=self.min_speed.get(),
                quiet=True,
                cancel_event=self.cancel_event,
                on_status=self._on_status,
            )
            self.root.after(0, self._on_done, out_path, None, False)
        except CancelledError:
            self.root.after(0, self._on_done, out_path, None, True)
        except ProcessingError as e:
            self.root.after(0, self._on_done, out_path, str(e), False)
        except Exception as e:  # errori imprevisti -> messaggio pulito nella GUI
            self.root.after(0, self._on_done, out_path, str(e), False)
        finally:
            self._processing = False

    def _on_done(self, out_path: str, error: str | None, cancelled: bool) -> None:
        self.spinner.ferma()
        self._set_buttons(running=False)
        elapsed = time.time() - self._start_time
        if cancelled:
            self._set_progress(0, "Interrotto dall'utente.")
            self._log("[!] Interrotto dall'utente. Nessun file di output creato.")
        elif error:
            self._set_progress(0, "Errore.")
            self._log(f"[ERRORE] {error}")
            messagebox.showerror("Errore", error)
        else:
            self._output_path = out_path
            self._set_progress(1, f"Completato in {elapsed:.0f}s.")
            self._set_link("▶ Apri il video elaborato")
            self._log(f"[OK] Completato in {elapsed:.0f}s: {out_path}")
            messagebox.showinfo("Completato", f"Video salvato in:\n{out_path}")


def main() -> int:
    root = ctk.CTk() if USE_CTK else tk.Tk()
    App(root)
    root.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
