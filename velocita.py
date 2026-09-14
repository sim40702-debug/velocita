import os
import sys
import cv2
import numpy as np
import subprocess
import shutil
import time
import threading
from PIL import Image, ImageDraw, ImageFont

# Importazione GUI
try:
    import customtkinter as ctk
    USE_CTK = True
    ctk.set_appearance_mode("Dark")
    ctk.set_default_color_theme("blue")
except ImportError:
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    USE_CTK = False

# ==========================================
# RILEVAMENTO DINAMICO E EMOJI PIL
# ==========================================

class DynamicDashboardTracker:
    def __init__(self, mode="orange", custom_text="😎", text_scale_multiplier=1.0, debug=False):
        self.mode = mode
        self.custom_text = custom_text if custom_text else "😎"
        self.scale_mult = text_scale_multiplier
        self.debug = debug
        
        # Carica un font di sistema Unicode/Emoji
        self.font_path = self._get_system_font()

    def _get_system_font(self):
        # Cerca un font con supporto Emoji nei principali sistemi operativi
        fonts_to_check = [
            "seguiemj.ttf",                  # Windows Segoe UI Emoji
            "/System/Library/Fonts/Apple Color Emoji.ttc", # macOS Emoji
            "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", # Linux Noto Emoji
            "arial.ttf"                       # Fallback standard
        ]
        for font in fonts_to_check:
            if os.path.exists(font) or sys.platform.startswith("win"):
                return font
        return None

    def _draw_emoji_pil(self, img_bgr, text, x, y, w, h):
        # Converte da BGR (OpenCV) a RGB (PIL)
        img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        pil_img = Image.fromarray(img_rgb)
        draw = ImageDraw.Draw(pil_img)

        # Calcola dimensione del font in pixel
        font_size = int(h * 0.7 * self.scale_mult)
        font_size = max(12, font_size)

        try:
            if self.font_path:
                font = ImageFont.truetype(self.font_path, font_size)
            else:
                font = ImageFont.load_default()
        except Exception:
            font = ImageFont.load_default()

        # Calcola posizione centrata
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
        
        pos_x = x + (w - text_w) // 2
        pos_y = y + (h - text_h) // 2 - bbox[1]

        # Disegna il testo/emoji mantenendo i colori nativi dell'emoji
        draw.text((pos_x, pos_y), text, font=font, embedded_color=True)

        # Riconverte da RGB (PIL) a BGR (OpenCV)
        return cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2BGR)

    def process_frame(self, frame):
        processed_frame = frame.copy()
        
        # Conversione HSV per rilevare il display arancione
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        lower_orange = np.array([0, 110, 120])
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
                roi = processed_frame[y:y+h, x:x+w]
                
                if roi.size > 0:
                    if self.mode == "orange":
                        mean_color = cv2.mean(roi)[:3]
                        cv2.drawContours(processed_frame, [c], -1, mean_color, -1)
                        blur_zone = cv2.GaussianBlur(processed_frame[y:y+h, x:x+w], (15, 15), 0)
                        processed_frame[y:y+h, x:x+w] = blur_zone

                    elif self.mode == "emoji":
                        # Pialla i vecchi numeri con un filtro mediano
                        clean_roi = cv2.medianBlur(roi, 31)
                        processed_frame[y:y+h, x:x+w] = clean_roi
                        
                        # Inserisce l'emoji tramite rendering PIL
                        processed_frame = self._draw_emoji_pil(processed_frame, self.custom_text, x, y, w, h)

                if self.debug:
                    cv2.rectangle(processed_frame, (x, y), (x + w, y + h), (0, 255, 0), 2)

        return processed_frame

# ==========================================
# INTERFACCIA GRAFICA (GUI)
# ==========================================

class ModernSpeedometerApp:
    def __init__(self, root):
        self.root = root
        self.root.title("Auto-Tracker Dashboard Engine v6.0 (Unicode Emoji)")
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
        ctk.CTkLabel(header, text="🎯 Auto-Tracking Dashboard (Unicode Emoji Support)", font=ctk.CTkFont(size=18, weight="bold")).pack(padx=15, pady=10)

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

        ctk.CTkLabel(params_frame, text="Modalità:").grid(row=0, column=0, padx=10, pady=5)
        self.mode_option = ctk.CTkOptionMenu(params_frame, values=["Emoji / Simbolo", "Sfondo Arancione Pieno"])
        self.mode_option.grid(row=0, column=1, padx=10, pady=5)

        self.switch_debug = ctk.CTkSwitch(params_frame, text="Debug Visivo")
        self.switch_debug.grid(row=0, column=2, padx=15, pady=5)

        ctk.CTkLabel(params_frame, text="Emoji / Testo:").grid(row=1, column=0, padx=10, pady=10)
        self.entry_emoji = ctk.CTkEntry(params_frame, width=120)
        self.entry_emoji.insert(0, "😎")
        self.entry_emoji.grid(row=1, column=1, padx=10, pady=10, sticky="w")

        ctk.CTkLabel(params_frame, text="Dimensioni:").grid(row=2, column=0, padx=10, pady=5)
        self.slider_size = ctk.CTkSlider(params_frame, from_=0.5, to=3.0, number_of_steps=25)
        self.slider_size.set(1.0)
        self.slider_size.grid(row=2, column=1, padx=10, pady=5, sticky="ew")

        progress_frame = ctk.CTkFrame(self.root, corner_radius=10)
        progress_frame.grid(row=3, column=0, padx=15, pady=10, sticky="ew")

        self.progress_bar = ctk.CTkProgressBar(progress_frame, width=580)
        self.progress_bar.set(0)
        self.progress_bar.grid(row=0, column=0, padx=10, pady=10)

        self.lbl_percentage = ctk.CTkLabel(progress_frame, text="0%", font=ctk.CTkFont(size=14, weight="bold"))
        self.lbl_percentage.grid(row=0, column=1, padx=10, pady=10)

        self.btn_start = ctk.CTkButton(self.root, text="► AVVIA ELABORAZIONE", font=ctk.CTkFont(size=16, weight="bold"), height=40, command=self._start_thread)
        self.btn_start.grid(row=4, column=0, padx=15, pady=5, sticky="ew")

        self.txt_log = ctk.CTkTextbox(self.root, height=100)
        self.txt_log.grid(row=5, column=0, padx=15, pady=10, sticky="ew")

    def _build_standard_ui(self):
        frame = ttk.Frame(self.root, padding=15)
        frame.pack(fill=tk.BOTH, expand=True)

        ttk.Label(frame, text="Auto-Tracking Dashboard Engine", font=("Arial", 16, "bold")).pack(pady=5)

        f_inputs = ttk.LabelFrame(frame, text=" File & Destinazione ")
        f_inputs.pack(fill=tk.X, pady=5)

        self.entry_input = ttk.Entry(f_inputs, width=50)
        self.entry_input.grid(row=0, column=0, padx=5, pady=5)
        ttk.Button(f_inputs, text="Sfoglia Input", command=self._select_input).grid(row=0, column=1, padx=5)

        self.entry_output = ttk.Entry(f_inputs, width=50)
        self.entry_output.grid(row=1, column=0, padx=5, pady=5)
        ttk.Button(f_inputs, text="Sfoglia Output", command=self._select_output).grid(row=1, column=1, padx=5)

        f_opts = ttk.LabelFrame(frame, text=" Opzioni Emoji ")
        f_opts.pack(fill=tk.X, pady=5)

        self.mode_var = tk.StringVar(value="Emoji / Simbolo")
        ttk.OptionMenu(f_opts, self.mode_var, "Emoji / Simbolo", "Emoji / Simbolo", "Sfondo Arancione Pieno").grid(row=0, column=0, padx=10)

        ttk.Label(f_opts, text="Emoji:").grid(row=0, column=1)
        self.entry_emoji = ttk.Entry(f_opts, width=10)
        self.entry_emoji.insert(0, "😎")
        self.entry_emoji.grid(row=0, column=2, padx=5)

        ttk.Label(f_opts, text="Scala:").grid(row=0, column=3)
        self.slider_size = ttk.Scale(f_opts, from_=0.5, to=3.0, value=1.0)
        self.slider_size.grid(row=0, column=4, padx=5)

        self.debug_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(f_opts, text="Debug", variable=self.debug_var).grid(row=0, column=5, padx=5)

        f_prog = ttk.Frame(frame)
        f_prog.pack(fill=tk.X, pady=10)

        self.progress_bar = ttk.Progressbar(f_prog, orient="horizontal", mode="determinate")
        self.progress_bar.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))

        self.lbl_percentage = ttk.Label(f_prog, text="0%", font=("Arial", 10, "bold"))
        self.lbl_percentage.pack(side=tk.RIGHT)

        self.btn_start = ttk.Button(frame, text="AVVIA ELABORAZIONE", command=self._start_thread)
        self.btn_start.pack(fill=tk.X, pady=5)

        self.txt_log = tk.Text(frame, height=6, width=70)
        self.txt_log.pack(fill=tk.BOTH, expand=True, pady=5)

    def _select_input(self):
        file_path = filedialog.askopenfilename(
            filetypes=[("Media Files", "*.mp4 *.mov *.avi *.mkv *.jpg *.jpeg *.png *.webp")]
        )
        if file_path:
            self.input_path = file_path
            self.entry_input.delete(0, tk.END if not USE_CTK else ctk.END)
            self.entry_input.insert(0, file_path)

            if not self.output_dir:
                self.output_dir = os.path.dirname(file_path)
                self.entry_output.delete(0, tk.END if not USE_CTK else ctk.END)
                self.entry_output.insert(0, self.output_dir)

    def _select_output(self):
        folder_path = filedialog.askdirectory()
        if folder_path:
            self.output_dir = folder_path
            self.entry_output.delete(0, tk.END if not USE_CTK else ctk.END)
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
            if not USE_CTK:
                messagebox.showerror("Errore", "Selezionare un file di input valido.")
            return

        selected_mode_text = self.mode_option.get() if USE_CTK else self.mode_var.get()
        mode = "emoji" if "Emoji" in selected_mode_text else "orange"
        custom_text = self.entry_emoji.get()
        scale_val = float(self.slider_size.get())
        debug = self.switch_debug.get() == 1 if USE_CTK else self.debug_var.get()

        if USE_CTK:
            self.btn_start.configure(state="disabled")
            self.progress_bar.set(0)
            self.lbl_percentage.configure(text="0%")
        else:
            self.btn_start.config(state="disabled")
            self.progress_bar['value'] = 0
            self.lbl_percentage.config(text="0%")

        t = threading.Thread(target=self._process, args=(in_p, out_p, mode, custom_text, scale_val, debug))
        t.daemon = True
        t.start()

    def _process(self, in_file, out_dir, mode, custom_text, scale_val, debug):
        try:
            filename = os.path.basename(in_file)
            name, ext = os.path.splitext(filename)

            processor = DynamicDashboardTracker(mode=mode, custom_text=custom_text, text_scale_multiplier=scale_val, debug=debug)

            self.log(f"[+] Elaborazione in corso... Emoji: '{custom_text}', Scala: {scale_val:.1f}")
            cap = cv2.VideoCapture(in_file)
            if not cap.isOpened():
                raise ValueError("Impossibile aprire il file video.")

            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

            temp_out = os.path.join(out_dir, f"temp_{name}.mp4")
            final_out = os.path.join(out_dir, f"{name}_emoji.mp4")

            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(temp_out, fourcc, fps, (frame_w, frame_h))

            count = 0
            while cap.isOpened():
                ret, frame = cap.read()
                if not ret:
                    break

                processed_frame = processor.process_frame(frame)
                out.write(processed_frame)

                count += 1
                if total_frames > 0:
                    pct = count / total_frames
                    self.root.after(0, self._update_progress, pct)

            cap.release()
            out.release()

            self.log("[+] Sincronizzazione audio...")
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

            self.log(f"[✓] Completato! File salvato: {final_out}")

        except Exception as e:
            self.log(f"[ERRORE] {str(e)}")
        finally:
            self.root.after(0, self._reset_ui)

    def _update_progress(self, pct):
        percent_str = f"{int(pct * 100)}%"
        if USE_CTK:
            self.progress_bar.set(pct)
            self.lbl_percentage.configure(text=percent_str)
        else:
            self.progress_bar['value'] = pct * 100
            self.lbl_percentage.config(text=percent_str)

    def _reset_ui(self):
        if USE_CTK:
            self.btn_start.configure(state="normal")
        else:
            self.btn_start.config(state="normal")

if __name__ == "__main__":
    if USE_CTK:
        root = ctk.CTk()
    else:
        root = tk.Tk()
    
    app = ModernSpeedometerApp(root)
    root.mainloop()