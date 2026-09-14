import os
import sys
import cv2
import numpy as np
import subprocess
import shutil
import time
import threading
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
# RILEVAMENTO E GESTIONE DEBUG / RIEMPIMENTO
# ==========================================

class DynamicDashboardTracker:
    def __init__(self, debug=False):
        self.debug = debug

    def process_frame(self, frame):
        processed_frame = frame.copy()
        
        # Conversione HSV per rilevare il display arancione in modo preciso
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower_orange = np.array([0, 100, 100])
        upper_orange = np.array([25, 255, 255])
        
        mask = cv2.inRange(hsv, lower_orange, upper_orange)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if contours:
            c = max(contours, key=cv2.contourArea)
            
            if cv2.contourArea(c) > 500:
                x, y, w, h = cv2.boundingRect(c)
                
                # Se il DEBUG è attivo, disegna SOLO il riquadro verde e non applica alcuna modifica grafica
                if self.debug:
                    cv2.rectangle(processed_frame, (x, y), (x + w, y + h), (0, 255, 0), 2)
                else:
                    # Se il DEBUG è spento, esegue il riempimento arancione pieno sulla sagoma
                    roi = processed_frame[y:y+h, x:x+w]
                    if roi.size > 0:
                        mean_color = cv2.mean(roi)[:3]
                        display_mask = np.zeros(processed_frame.shape[:2], dtype=np.uint8)
                        cv2.drawContours(display_mask, [c], -1, 255, thickness=cv2.FILLED)
                        processed_frame[display_mask == 255] = mean_color

        return processed_frame

# ==========================================
# INTERFACCIA GRAFICA (GUI) PULITA
# ==========================================

class ModernSpeedometerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Auto-Tracker Dashboard Engine (Solid Orange)")
        self.root.geometry("800x680")

        self.input_path = ""
        self.output_dir = ""

        self._build_gui()

    def _build_gui(self):
        if USE_CTK:
            self._build_customtkinter_ui()
        else:
            self._build_standard_ui()

    def _build_customtkinter_ui(self):
        self.root.grid_columnconfigure(0, weight=1)
        
        header = ctk.CTkFrame(self.root, corner_radius=10)
        header.grid(row=0, column=0, padx=15, pady=10, sticky="ew")
        ctk.CTkLabel(header, text="🎯 Dashboard Solid Orange Cleaner", font=ctk.CTkFont(size=18, weight="bold")).pack(padx=15, pady=10)

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

        self.switch_debug = ctk.CTkSwitch(params_frame, text="Debug Visivo (Mostra Solo Riquadro Verde)")
        self.switch_debug.grid(row=0, column=0, padx=15, pady=10, sticky="w")

        progress_frame = ctk.CTkFrame(self.root, corner_radius=10)
        progress_frame.grid(row=3, column=0, padx=15, pady=10, sticky="ew")
        progress_frame.grid_columnconfigure(0, weight=1)

        self.progress_bar = ctk.CTkProgressBar(progress_frame, width=580)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=0, column=0, padx=10, pady=(10, 5), sticky="ew")

        self.lbl_percentage = ctk.CTkLabel(progress_frame, text="0%", font=ctk.CTkFont(size=14, weight="bold"))
        self.lbl_percentage.grid(row=0, column=1, padx=10, pady=(10, 5))

        self.lbl_details = ctk.CTkLabel(progress_frame, text="Stato: In attesa di elaborazione...", font=ctk.CTkFont(size=12))
        self.lbl_details.grid(row=1, column=0, columnspan=2, padx=10, pady=(0, 10))

        self.btn_start = ctk.CTkButton(self.root, text="► AVVIA ELABORAZIONE", font=ctk.CTkFont(size=16, weight="bold"), height=40, command=self._start_thread)
        self.btn_start.grid(row=4, column=0, padx=15, pady=5, sticky="ew")

        self.txt_log = ctk.CTkTextbox(self.root, height=120)
        self.txt_log.grid(row=5, column=0, padx=15, pady=10, sticky="ew")

    def _build_standard_ui(self):
        frame = tk.Frame(self.root, padx=15, pady=15)
        frame.pack(fill=tk.BOTH, expand=True)

        tk.Label(frame, text="Dashboard Solid Orange Cleaner", font=("Arial", 16, "bold")).pack(pady=5)

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
        tk.Checkbutton(f_opts, text="Debug Visivo (Mostra Solo Riquadro Verde)", variable=self.debug_var).pack(anchor="w", padx=10, pady=5)

        f_prog = tk.Frame(frame)
        f_prog.pack(fill=tk.X, pady=10)

        self.progress_bar = ttk.Progressbar(f_prog, orient="horizontal", mode="determinate")
        self.progress_bar.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))

        self.lbl_percentage = tk.Label(f_prog, text="0%", font=("Arial", 10, "bold"))
        self.lbl_percentage.pack(side=tk.RIGHT)

        self.lbl_details = tk.Label(frame, text="Stato: In attesa di elaborazione...", font=("Arial", 10))
        self.lbl_details.pack(pady=2)

        self.btn_start = tk.Button(frame, text="AVVIA ELABORAZIONE", command=self._start_thread, font=("Arial", 11, "bold"))
        self.btn_start.pack(fill=tk.X, pady=5)

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
        else:
            self.btn_start.config(state="disabled")
            self.lbl_percentage.config(text="0%")
            self.lbl_details.config(text="Avvio in corso...")

        t = threading.Thread(target=self._process, args=(in_p, out_p, debug))
        t.daemon = True
        t.start()

    def _process(self, in_file, out_dir, debug):
        try:
            filename = os.path.basename(in_file)
            name, ext = os.path.splitext(filename)

            processor = DynamicDashboardTracker(debug=debug)

            self.log(f"[+] Elaborazione file: {filename} [Debug: {debug}]")
            cap = cv2.VideoCapture(in_file)
            if not cap.isOpened():
                raise ValueError("Impossibile aprire il file video.")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            temp_out = os.path.join(out_dir, f"temp_{name}.mp4")
            final_out = os.path.join(out_dir, f"{name}_solid_orange.mp4")

            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(temp_out, fourcc, fps, (frame_w, frame_h))

            count = 0
            start_time = time.time()

            while cap.isOpened():
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

            self.log("[+] Sincronizzazione audio in corso...")
            ffmpeg_bin = shutil.which("ffmpeg")
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

            self.log(f"[✓] Completato con successo! Salvato in: {final_out}")

        except Exception as e:
            self.log(f"[ERRORE] {str(e)}")
        finally:
            self.root.after(0, self._reset_ui)

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
        if USE_CTK:
            self.btn_start.configure(state="normal")
            self.lbl_details.configure(text="Elaborazione completata.")
        else:
            self.btn_start.config(state="normal")
            self.lbl_details.config(text="Elaborazione completata.")

if __name__ == "__main__":
    if USE_CTK:
        root = ctk.CTk()
    else:
        root = tk.Tk()
    
    app = ModernSpeedometerApp(root)
    root.mainloop()