# Scarica ffmpeg e lo mette in src-tauri/binaries con il nome che vuole Tauri.
# Lo prende dal pacchetto Python "imageio-ffmpeg", che ha ffmpeg già pronto
# per Mac (Apple Silicon e Intel) e Windows.
#
# Uso:
#   python3 scripts/prendi_ffmpeg.py                        -> per questo computer
#   python3 scripts/prendi_ffmpeg.py universal-apple-darwin -> Mac Apple Silicon + Intel
#   python3 scripts/prendi_ffmpeg.py x86_64-pc-windows-msvc -> Windows

import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

CARTELLA_BINARI = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "binaries")

# per ogni sistema: quale pacchetto scaricare
PIATTAFORME = {
    "aarch64-apple-darwin": "macosx_11_0_arm64",
    "x86_64-apple-darwin": "macosx_10_9_x86_64",
    "x86_64-pc-windows-msvc": "win_amd64",
    "x86_64-unknown-linux-gnu": "manylinux2014_x86_64",
}


def sistema_di_questo_computer():
    # rustc -vV scrive ad esempio "host: aarch64-apple-darwin"
    testo = subprocess.run(["rustc", "-vV"], capture_output=True, text=True).stdout
    for riga in testo.splitlines():
        if riga.startswith("host:"):
            return riga.split(":")[1].strip()
    sys.exit("Non riesco a capire il sistema (serve Rust installato).")


def scarica(sistema, cartella_temporanea):
    """Scarica ffmpeg per un sistema e ritorna il percorso del file."""
    piattaforma = PIATTAFORME[sistema]
    destinazione = os.path.join(cartella_temporanea, sistema)
    subprocess.run(
        [sys.executable, "-m", "pip", "download", "imageio-ffmpeg", "--no-deps",
         "--only-binary=:all:", "--platform", piattaforma, "-d", destinazione, "-q"],
        check=True,
    )
    pacchetto = [f for f in os.listdir(destinazione) if f.endswith(".whl")][0]
    with zipfile.ZipFile(os.path.join(destinazione, pacchetto)) as z:
        for nome in z.namelist():
            if "/binaries/ffmpeg-" in nome:
                z.extract(nome, destinazione)
                return os.path.join(destinazione, nome)
    sys.exit("ffmpeg non trovato nel pacchetto per " + sistema)


def main():
    sistema = sys.argv[1] if len(sys.argv) > 1 else sistema_di_questo_computer()
    os.makedirs(CARTELLA_BINARI, exist_ok=True)

    # la cartella temporanea si cancella da sola alla fine
    with tempfile.TemporaryDirectory() as temporanea:
        if sistema == "universal-apple-darwin":
            # unisce le versioni Apple Silicon e Intel in un solo file
            arm = scarica("aarch64-apple-darwin", temporanea)
            intel = scarica("x86_64-apple-darwin", temporanea)
            finale = os.path.join(CARTELLA_BINARI, "ffmpeg-universal-apple-darwin")
            subprocess.run(["lipo", "-create", arm, intel, "-output", finale], check=True)
            # Tauri vuole anche le due versioni separate mentre compila
            for nome, file in [("aarch64-apple-darwin", arm), ("x86_64-apple-darwin", intel)]:
                separato = os.path.join(CARTELLA_BINARI, "ffmpeg-" + nome)
                shutil.copyfile(file, separato)
                os.chmod(separato, 0o755)
        elif sistema in PIATTAFORME:
            estensione = ".exe" if "windows" in sistema else ""
            finale = os.path.join(CARTELLA_BINARI, "ffmpeg-" + sistema + estensione)
            shutil.copyfile(scarica(sistema, temporanea), finale)
        else:
            sys.exit("Sistema non previsto: " + sistema)

    os.chmod(finale, 0o755)
    print("ffmpeg pronto:", os.path.normpath(finale))


if __name__ == "__main__":
    main()
