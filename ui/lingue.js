// LINGUE: Velocità è scritta in italiano. Qui ci sono le traduzioni
// in inglese e tedesco: a sinistra il testo italiano, a destra quello tradotto.
//
// Come funziona:
// - t("testo") restituisce il testo nella lingua scelta (o lo stesso, se manca)
// - t("{n} video", { n: 3 }) mette i numeri al posto delle {graffe}
// - traduciPagina() traduce tutte le scritte della finestra, e continua a
//   tradurre quelle che l'app cambia mentre la usi

const TRADUZIONI = {
  en: {
    // ---------- inizio e file ----------
    "Trascina qui i video della moto": "Drag your motorbike videos here",
    "Uno o più video, oppure delle foto. Il numero della velocità viene coperto in automatico.":
      "One or more videos, or photos. The speed number is covered automatically.",
    "Scegli file…": "Choose files…",
    "oppure ⌘O ·": "or ⌘O ·",
    "scegli una cartella": "choose a folder",
    "MP4 · MOV · MKV · AVI · JPG · PNG · WEBP": "MP4 · MOV · MKV · AVI · JPG · PNG · WEBP",
    "I tuoi video non vengono mai inviati in internet: tutto avviene sul computer.":
      "Your videos are never sent over the internet: everything happens on your computer.",
    "{n} video": "{n} videos",
    "1 video": "1 video",
    "{n} foto": "{n} photos",
    "{n} file": "{n} files",
    "File": "Files",
    "Cartella…": "Folder…",
    "Aggiungi": "Add",
    "Foto": "Photo",
    "Video": "Video",
    "Togli dalla coda": "Remove from queue",
    "Trascina per cambiare l'ordine (⌥↑ ⌥↓) · Canc per togliere": "Drag to reorder (⌥↑ ⌥↓) · Delete to remove",
    "Nessun file da usare": "No files to use",
    "Scegli un video (MP4, MOV, MKV, AVI) o una foto (JPG, PNG, WEBP), o una cartella che li contiene.":
      "Choose a video (MP4, MOV, MKV, AVI) or a photo (JPG, PNG, WEBP), or a folder that contains them.",
    "Non riesco ad aprire il file": "I can't open the file",

    // ---------- anteprima ----------
    "Anteprima": "Preview",
    "Carico l'anteprima…": "Loading preview…",
    "Qui non trovo il display.": "I can't find the display here.",
    "Qui non trovo il display": "I can't find the display here",
    "Prova a spostare il cursore su un altro punto del video.": "Try moving the slider to another point of the video.",
    "La zona tratteggiata è quella che verrà coperta. Doppio clic sulla zona per regolarla.":
      "The dashed area is what will be covered. Double-click the area to adjust it.",
    "In questa foto il numero non verrebbe coperto.": "In this photo the number would not be covered.",
    "Anteprima non disponibile:": "Preview not available:",
    "Anteprima animata non disponibile:": "Animated preview not available:",
    "Guarda 3 s": "Watch 3 s",
    "Guarda 3 secondi": "Watch 3 seconds",
    "Guarda 3 secondi del risultato (Spazio)": "Watch 3 seconds of the result (Space)",
    "Ferma": "Stop",
    "Originale": "Original",
    "Risultato": "Result",
    "Originale / Risultato": "Original / Result",
    "Originale o risultato": "Original or result",
    "Tasto R": "Key R",
    "Schermo intero": "Full screen",
    "Schermo intero (F)": "Full screen (F)",
    "Esci dallo schermo intero (Esc)": "Exit full screen (Esc)",
    "Schermo intero (Esc per uscire)": "Full screen (Esc to exit)",
    "Punto del video": "Point in the video",
    "Giorno": "Day",
    "Notte": "Night",
    "Ovunque": "Anywhere",
    "Display non trovato": "Display not found",
    "Zona disegnata a mano": "Area drawn by hand",

    // ---------- striscia e taglio ----------
    "Copertura del video: con le frecce salti ai punti da controllare": "Video coverage: use the arrows to jump to points to check",
    "Clicca per andare in quel punto · frecce: salta ai punti da controllare": "Click to go to that point · arrows: jump to points to check",
    "[ Inizio qui": "[ Start here",
    "Fine qui ]": "End here ]",
    "Il video salvato inizia qui (tasto I)": "The saved video starts here (key I)",
    "Il video salvato finisce qui (tasto O)": "The saved video ends here (key O)",
    "Il pezzo deve durare almeno 1 secondo: l'inizio va prima della fine.":
      "The part must last at least 1 second: the start must come before the end.",
    "Analisi del video… {n}%": "Analysing the video… {n}%",
    "Analisi non riuscita": "Analysis failed",
    "Analisi non riuscita:": "Analysis failed:",
    "Analisi…": "Analysing…",
    "Da analizzare": "Not analysed yet",
    "Display trovato in tutto il video": "Display found in the whole video",
    "Coperto": "Covered",
    "Da controllare": "To check",
    "Non trovato": "Not found",
    "A mano": "By hand",
    "Segue": "Follows",
    "1 tratto": "1 section",
    "{n} tratti": "{n} sections",
    "1 zona": "1 area",
    "{n} zone": "{n} areas",
    "1 oggetto": "1 object",
    "{n} oggetti": "{n} objects",
    "Tutto coperto": "All covered",
    "1 tratto non trovato": "1 section not found",
    "{n} tratti non trovati": "{n} sections not found",
    "1 tratto da controllare": "1 section to check",
    "{n} tratti da controllare": "{n} sections to check",
    "Clicca sulla striscia o usa le frecce per andarci": "Click the strip or use the arrows to go there",
    "Copri a mano un tratto rosso": "Cover a red section by hand",
    "Non ci sono punti da controllare.": "There are no points to check.",
    "Non ci sono altri punti da controllare più avanti.": "There are no more points to check further on.",
    "Non ci sono punti da controllare prima di questo.": "There are no points to check before this one.",

    // ---------- pannello ----------
    "Solo questo video": "This video only",
    "Zona": "Area",
    "Automatica": "Automatic",
    "Regolata a mano": "Adjusted by hand",
    "Regola…": "Adjust…",
    "Zone a mano": "Areas by hand",
    "Dove il display non viene trovato, disegni tu cosa coprire": "Where the display isn't found, you draw what to cover",
    "Nessuna": "None",
    "Copri qui…": "Cover here…",
    "Disegna una zona da coprire: ferma, o che segue un oggetto come una targa":
      "Draw an area to cover: fixed, or following an object like a number plate",
    "Vai e modifica": "Go and edit",
    "ferma": "fixed",
    "segue": "follows",
    "Parte": "Part",
    "Tutto il video": "Whole video",
    "Tutto": "All",
    "Per tutti i video": "For all videos",
    "Preset": "Presets",
    "+ Salva": "+ Save",
    "Usa queste impostazioni": "Use these settings",
    "Salva stile, forza, margine e display con un nome": "Save style, strength, margin and display with a name",
    "Salva preset": "Save preset",
    "Stile, forza, margine e impostazioni del display vengono salvati con questo nome.":
      "Style, strength, margin and display settings are saved with this name.",
    "Salva": "Save",
    "Nome": "Name",
    "Eliminare «{nome}»?": "Delete «{nome}»?",
    "Le impostazioni di adesso non cambiano.": "Your current settings don't change.",
    "Stile": "Style",
    "Pixel": "Pixel",
    "Sfocato": "Blur",
    "Nero": "Black",
    "Tinta": "Colour",
    "Forza": "Strength",
    "Margine": "Margin",
    "Piccolo": "Small",
    "Normale": "Normal",
    "Grande": "Large",
    "Manuale": "Manual",
    "Margine a mano": "Margin by hand",
    "margine {n}%": "margin {n}%",
    "volti": "faces",
    "Copri anche i volti": "Also cover faces",
    "Copre anche le facce delle persone viste di fronte": "Also covers the faces of people seen from the front",
    "Più forza = quadrati più grandi.": "More strength = bigger squares.",
    "Più forza = più sfocato.": "More strength = more blur.",
    "Con «Guarda 3 s» vedi il risultato.": "With «Watch 3 s» you see the result.",
    "Più forza = quadrati più grandi. Con «Guarda 3 s» vedi il risultato.":
      "More strength = bigger squares. With «Watch 3 s» you see the result.",
    "Salva in": "Save in",
    "Accanto al video": "Next to the video",
    "Salva accanto al video": "Save next to the video",
    "Cambia": "Change",
    "in tutto": "in total",
    "Avvia": "Start",
    "Avvia ({n} file)": "Start ({n} files)",

    // ---------- regola la zona ----------
    "Trascina o tira gli angoli": "Drag or pull the corners",
    "Con le frecce sposti, con Maiusc + frecce cambi la grandezza": "Arrows move it, Shift + arrows change the size",
    "Vale per": "Applies to",
    "Questo video": "This video",
    "Tutti i video": "All videos",
    "Ripristina": "Reset",
    "Annulla": "Cancel",
    "Applica": "Apply",
    "Elimina": "Delete",
    "Dal": "From",
    "al": "to",
    "Mezzo secondo prima": "Half a second earlier",
    "Mezzo secondo dopo": "Half a second later",
    "Inizio prima": "Start earlier",
    "Inizio dopo": "Start later",
    "Fine prima": "End earlier",
    "Fine dopo": "End later",
    "«Segue» va dietro all'oggetto che si muove, per esempio una targa":
      "«Follows» goes after the moving object, for example a number plate",
    "Qui il display non viene trovato: sposta il cursore su un punto verde della striscia, poi premi «Regola…».":
      "The display isn't found here: move the slider to a green point of the strip, then press «Adjust…».",

    // ---------- prima di esportare ----------
    "Alcuni punti non sono coperti": "Some points aren't covered",
    "In «{nome}» c'è 1 tratto rosso: lì il display non viene trovato e la velocità resterebbe visibile.":
      "In «{nome}» there is 1 red section: the display isn't found there and the speed would stay visible.",
    "In «{nome}» ci sono {n} tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.":
      "In «{nome}» there are {n} red sections: the display isn't found there and the speed would stay visible.",
    "In {n} video ci sono tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.":
      "{n} videos have red sections: the display isn't found there and the speed would stay visible.",
    "Puoi controllarli e regolare la zona, oppure esportare lo stesso.": "You can check them and adjust the area, or export anyway.",
    "Controlla": "Check",
    "Esporta lo stesso": "Export anyway",

    // ---------- elaborazione ----------
    "Elaborazione": "Processing",
    "Preparo…": "Preparing…",
    "Avvio…": "Starting…",
    "Sto lavorando…": "Working…",
    "File {n} di {totale}": "File {n} of {totale}",
    "Fotogramma {n} di {totale}": "Frame {n} of {totale}",
    "{n} di {totale} fotogrammi": "{n} of {totale} frames",
    "Mancano circa {tempo}": "About {tempo} left",
    "Salvo il video…": "Saving the video…",
    "Puoi usare il computer mentre lavora.": "You can use your computer while it works.",
    "Mostra dettagli": "Show details",
    "Nascondi dettagli": "Hide details",
    "Interrompi": "Stop",
    "Interruzione…": "Stopping…",
    "Interrompere?": "Stop?",
    "Il video in corso non verrà salvato. I file già finiti restano.": "The current video won't be saved. Files already finished stay.",
    "Continua": "Continue",
    "Chiudere Velocità?": "Close Velocità?",
    "Sta ancora lavorando: il video in corso non verrà salvato.": "It's still working: the current video won't be saved.",
    "Chiudi": "Close",
    "Fatto": "Done",
    "Fatto in {tempo}": "Done in {tempo}",
    "Non riuscito": "Failed",
    "Inizio:": "Start:",
    "Salvato:": "Saved:",
    "Attenzione: display mai trovato in {nome}": "Warning: display never found in {nome}",
    "Errore con {nome}:": "Error with {nome}:",
    "Interrotto dall'utente.": "Stopped by the user.",

    // ---------- fine ----------
    "Fatto, ma controlla": "Done, but check",
    "Non è andata": "It didn't work",
    "Nessun file è stato creato.": "No file was created.",
    "In {nomi} non ho trovato il display.": "I didn't find the display in {nomi}.",
    "In {nomi} alcuni tratti non sono coperti.": "In {nomi} some sections aren't covered.",
    "1 file non è stato elaborato (il motivo è qui sotto).": "1 file wasn't processed (the reason is below).",
    "{n} file non sono stati elaborati (il motivo è qui sotto).": "{n} files weren't processed (the reason is below).",
    "Con «Correggi» torni al video e lo sistemi.": "With «Fix» you go back to the video and fix it.",
    "{nome} è nella cartella scelta.": "{nome} is in the chosen folder.",
    "{nome} è accanto all'originale.": "{nome} is next to the original.",
    "{n} file pronti.": "{n} files ready.",
    "Tempo impiegato: {tempo}": "Time taken: {tempo}",
    "Display non trovato: controlla": "Display not found: check",
    "1 tratto non coperto": "1 section not covered",
    "{n} tratti non coperti": "{n} sections not covered",
    "Correggi": "Fix",
    "Apri": "Open",
    "Apri video": "Open video",
    "Apri foto": "Open photo",
    "Mostra nella cartella": "Show in folder",
    "Torna ai video": "Back to videos",
    "Nuovi video": "New videos",
    "Copia dettagli": "Copy details",
    "Copiato": "Copied",

    // ---------- errori ----------
    "Il disco è pieno: libera un po' di spazio e riprova.": "The disk is full: free up some space and try again.",
    "Non ho il permesso di salvare in quella cartella: scegline un'altra in «Salva in».":
      "I'm not allowed to save in that folder: choose another one in «Save in».",
    "Non trovo più il file: forse è stato spostato o il disco è stato scollegato.":
      "I can't find the file anymore: maybe it was moved or the disk was disconnected.",
    "Manca un pezzo dell'app (ffmpeg). Prova a reinstallare Velocità.": "A part of the app is missing (ffmpeg). Try reinstalling Velocità.",
    "Il file sembra rovinato o incompleto. Prova a copiarlo di nuovo dalla videocamera.":
      "The file seems damaged or incomplete. Try copying it again from the camera.",
    "In questa foto non trovo il display: prova a cambiare il colore in Impostazioni › Display.":
      "I can't find the display in this photo: try changing the colour in Settings › Display.",
    "Non sono riuscito a salvare il video. Controlla che ci sia spazio sul disco e riprova.":
      "I couldn't save the video. Check there is space on the disk and try again.",
    "Qualcosa è andato storto con questo file.": "Something went wrong with this file.",
    "Errore interno di Velocità (non è colpa del video): clicca «Copia dettagli» e mandalo a chi fa l'app.":
      "Internal Velocità error (not the video's fault): click «Copy details» and send it to the app's developer.",

    // ---------- impostazioni ----------
    "Impostazioni": "Settings",
    "Impostazioni (⌘,)": "Settings (⌘,)",
    "Impostazioni…": "Settings…",
    "Generale": "General",
    "Come lavora Velocità.": "How Velocità works.",
    "Mostra i riquadri nel video": "Show boxes in the video",
    "Modalità prova: invece di pixelare, disegna nel video la zona trovata. Serve per controllare il rilevamento.":
      "Test mode: instead of pixelating, it draws the found area in the video. Useful to check the detection.",
    "Cartella sorvegliata": "Watched folder",
    "Con Velocità aperta, i video nuovi messi in questa cartella vengono coperti da soli (con le impostazioni di adesso).":
      "While Velocità is open, new videos put in this folder are covered automatically (with the current settings).",
    "Smetti di sorvegliare": "Stop watching",
    "Scegli…": "Choose…",
    "Cartella sorvegliata: 1 video nuovo": "Watched folder: 1 new video",
    "Cartella sorvegliata: {n} video nuovi": "Watched folder: {n} new videos",
    "Forza e margine della copertura si regolano a destra dell'anteprima, mentre guardi il video.":
      "Strength and margin of the cover are set to the right of the preview, while you watch the video.",
    "Lingua": "Language",
    "La lingua cambia al prossimo avvio di Velocità.": "The language changes the next time you open Velocità.",
    "Display": "Display",
    "Come l'app riconosce il display della moto.": "How the app recognises the motorbike display.",
    "Momento": "Time of day",
    "Automatico capisce da solo se il video è di giorno o di notte.": "Automatic works out by itself whether the video is by day or by night.",
    "Auto": "Auto",
    "Automatico": "Automatic",
    "Colore del display": "Display colour",
    "Arancione": "Orange",
    "Rosso": "Red",
    "Giallo": "Yellow",
    "Verde": "Green",
    "Blu": "Blue",
    "Bianco": "White",
    "Colore dal video": "Colour from the video",
    "Colore preso dal video": "Colour taken from the video",
    "Clicca sul display nell'anteprima: l'app usa quel colore.": "Click the display in the preview: the app uses that colour.",
    "Per prendere il colore dal video, prima aggiungi un video o una foto.": "To take the colour from the video, first add a video or a photo.",
    "Posizione del display": "Display position",
    "In basso": "At the bottom",
    "«In basso» evita lampioni e finestre (consigliato). «Ovunque» se la videocamera è messa in un altro posto.":
      "«At the bottom» avoids street lights and windows (recommended). «Anywhere» if the camera is mounted somewhere else.",
    "Prestazioni": "Performance",
    "Quanto del computer usa Velocità mentre lavora.": "How much of the computer Velocità uses while working.",
    "Uso CPU": "CPU use",
    "Con meno CPU il computer resta più libero, ma ci mette di più.": "With less CPU the computer stays freer, but it takes longer.",
    "Quando è possibile il video viene creato con il chip del Mac o con la scheda video su Windows (NVIDIA, Intel, AMD): è molto più veloce.":
      "When possible the video is made with the Mac chip, or with the graphics card on Windows (NVIDIA, Intel, AMD): it's much faster.",
    "Aggiornamenti": "Updates",
    "Controlla all'avvio": "Check at startup",
    "Le versioni nuove arrivano da GitHub.": "New versions come from GitHub.",
    "Versione": "Version",
    "Versione {versione}": "Version {versione}",
    "Controlla ora": "Check now",
    "Controllo…": "Checking…",
    "Controllo non riuscito": "Check failed",
    "Hai l'ultima versione": "You have the latest version",
    "Disponibile la {versione}": "{versione} available",
    "È disponibile una nuova versione": "A new version is available",
    "È disponibile la versione {versione}": "Version {versione} is available",
    "Aggiorna": "Update",
    "Più tardi": "Later",
    "Riavvio…": "Restarting…",
    "Riprova": "Try again",
    "Aggiornamento non riuscito:": "Update failed:",

    // ---------- scegli il colore dal video ----------
    "Clicca sul display della moto": "Click the motorbike display",
    "Clicca sulla parte accesa del display. L'app cercherà quel colore in tutti i video.":
      "Click the lit part of the display. The app will look for that colour in all videos.",
    "Sposta il cursore per trovare un punto dove il display si vede bene.": "Move the slider to find a point where the display is clearly visible.",
    "Qui è troppo scuro: clicca sulla parte accesa del display": "It's too dark here: click the lit part of the display",
    "Colore scelto": "Chosen colour",
    "Usa questo colore": "Use this colour",

    // ---------- menu e scorciatoie ----------
    "Controlla aggiornamenti…": "Check for updates…",
    "Aggiungi video o foto…": "Add videos or photos…",
    "Aggiungi una cartella…": "Add a folder…",
    "Aggiungi video o foto": "Add videos or photos",
    "Aggiungi una cartella": "Add a folder",
    "Modifica": "Edit",
    "Finestra": "Window",
    "Aiuto": "Help",
    "Regola la zona…": "Adjust the area…",
    "Copri a mano qui…": "Cover by hand here…",
    "Inizio del pezzo qui": "Start of the part here",
    "Fine del pezzo qui": "End of the part here",
    "Scorciatoie da tastiera": "Keyboard shortcuts",
    "Un secondo avanti o indietro (con ⇧ 10 secondi)": "One second forward or back (with ⇧ 10 seconds)",
    "Frecce sulla striscia: al prossimo punto da controllare": "Arrows on the strip: to the next point to check",
    "Inizio e fine del pezzo da salvare": "Start and end of the part to save",
    "Spazio": "Space",
    "Cambia l'ordine della coda": "Change the order of the queue",
    "Regola la zona: frecce per spostare, ⇧ + frecce per la grandezza, ↩ per applicare, Esc per annullare":
      "Adjust the area: arrows to move, ⇧ + arrows for the size, ↩ to apply, Esc to cancel",

    // ---------- persone e targhe ----------
    "Persone": "People",
    "Copre le facce viste di fronte. L'esportazione è più lenta.": "Covers faces seen from the front. Exporting is slower.",
    "Targhe": "Number plates",
    "Con «Copri qui…» › «Segue» disegni la zona sulla targa e la segue.": "With «Cover here…» › «Follows» you draw the area on the plate and it follows it.",
    "persone": "people",
    "targhe": "plates",
    "segue · spenta": "follows · off",
    // ---------- grafica nuova e tratti da controllare ----------
    "1 tratto «Va bene così»": "1 section «Looks fine»",
    "{n} tratti «Va bene così»": "{n} sections «Looks fine»",
    "Va bene così": "Looks fine",
    "Copri a mano": "Cover by hand",
    "Qui non c'è niente da coprire: il tratto diventa verde": "Nothing to cover here: the section turns green",
    "Disegna tu la zona da coprire in questo tratto": "Draw the area to cover in this section yourself",
    "Tutto verde: non c'è niente da controllare.": "All green: there's nothing to check.",
    "Tratto prima": "Previous section",
    "Tratto dopo": "Next section",
    "{n} di {totale}": "{n} of {totale}",
    "Aspetto": "Appearance",
    "Come appare Velocità.": "How Velocità looks.",
    "Tema": "Theme",
    "Chiaro": "Light",
    "Scuro": "Dark",
    "Miniature nella lista dei video": "Thumbnails in the video list",
    "Mostra un fotogramma accanto a ogni video invece dell'icona.": "Shows a frame next to each video instead of the icon.",
    "Mostra «Fatti di recente»": "Show «Recently done»",
    "Gli ultimi video coperti nella schermata iniziale.": "The latest covered videos on the start screen.",
    "Rivedi «Come funziona»": "See «How it works» again",
    "Come funziona": "How it works",
    "Salta": "Skip",
    "Avanti": "Next",
    "Inizia": "Start",
    "Trascina i video della moto": "Drag in your motorbike videos",
    "Velocità trova il display in ogni fotogramma e copre il numero della velocità. I video restano sul tuo computer.": "Velocità finds the display in every frame and covers the speed number. Your videos stay on your computer.",
    "La striscia ti dice dove guardare": "The strip tells you where to look",
    "Verde: coperto. Arancione e rosso: da controllare. Con le frecce vai a ogni tratto: «Va bene così» o «Copri a mano», e diventa verde.": "Green: covered. Orange and red: to check. The arrows take you to each section: «Looks fine» or «Cover by hand», and it turns green.",
    "Avvia e il video è pronto": "Start, and the video is ready",
    "Il video coperto arriva accanto all'originale, con «_speed_blur» nel nome. Lo apri subito in DaVinci.": "The covered video appears next to the original, with «_speed_blur» in its name. Open it right away in DaVinci.",
    "Fatti di recente": "Recently done",
    "Svuota": "Clear",
    "oggi": "today",
    "ieri": "yesterday",
    "Il numero della velocità viene coperto da solo. Anche facce e targhe, se vuoi.": "The speed number is covered automatically. Faces and number plates too, if you want.",
    "Scegli i video…": "Choose videos…",
    "Scegli una cartella": "Choose a folder",
    "MP4, MOV, MKV, AVI e foto JPG, PNG, WEBP · tutto resta sul tuo computer": "MP4, MOV, MKV, AVI and JPG, PNG, WEBP photos · everything stays on your computer",
    "Confronto originale e risultato": "Compare original and result",
    "Trascina per confrontare": "Drag to compare",
    "Trascina per confrontare (tasto R: tutto originale o tutto risultato)": "Drag to compare (key R: all original or all result)",
    "Trascina: dove inizia il video salvato": "Drag: where the saved video starts",
    "Trascina: dove finisce il video salvato": "Drag: where the saved video ends",
  },

  de: {
    // ---------- inizio e file ----------
    "Trascina qui i video della moto": "Zieh die Motorradvideos hierher",
    "Uno o più video, oppure delle foto. Il numero della velocità viene coperto in automatico.":
      "Ein oder mehrere Videos, oder Fotos. Die Geschwindigkeitszahl wird automatisch verdeckt.",
    "Scegli file…": "Dateien wählen…",
    "oppure ⌘O ·": "oder ⌘O ·",
    "scegli una cartella": "einen Ordner wählen",
    "MP4 · MOV · MKV · AVI · JPG · PNG · WEBP": "MP4 · MOV · MKV · AVI · JPG · PNG · WEBP",
    "I tuoi video non vengono mai inviati in internet: tutto avviene sul computer.":
      "Deine Videos werden nie ins Internet geschickt: alles passiert auf dem Computer.",
    "{n} video": "{n} Videos",
    "1 video": "1 Video",
    "{n} foto": "{n} Fotos",
    "{n} file": "{n} Dateien",
    "File": "Dateien",
    "Cartella…": "Ordner…",
    "Aggiungi": "Hinzufügen",
    "Foto": "Foto",
    "Video": "Video",
    "Togli dalla coda": "Aus der Liste entfernen",
    "Trascina per cambiare l'ordine (⌥↑ ⌥↓) · Canc per togliere": "Ziehen zum Umsortieren (⌥↑ ⌥↓) · Entf zum Entfernen",
    "Nessun file da usare": "Keine Dateien",
    "Scegli un video (MP4, MOV, MKV, AVI) o una foto (JPG, PNG, WEBP), o una cartella che li contiene.":
      "Wähle ein Video (MP4, MOV, MKV, AVI) oder ein Foto (JPG, PNG, WEBP), oder einen Ordner, der sie enthält.",
    "Non riesco ad aprire il file": "Ich kann die Datei nicht öffnen",

    // ---------- anteprima ----------
    "Anteprima": "Vorschau",
    "Carico l'anteprima…": "Vorschau wird geladen…",
    "Qui non trovo il display.": "Hier finde ich das Display nicht.",
    "Qui non trovo il display": "Hier finde ich das Display nicht",
    "Prova a spostare il cursore su un altro punto del video.": "Schieb den Regler an eine andere Stelle im Video.",
    "La zona tratteggiata è quella che verrà coperta. Doppio clic sulla zona per regolarla.":
      "Der gestrichelte Bereich wird verdeckt. Doppelklick auf den Bereich, um ihn anzupassen.",
    "In questa foto il numero non verrebbe coperto.": "In diesem Foto würde die Zahl nicht verdeckt.",
    "Anteprima non disponibile:": "Vorschau nicht verfügbar:",
    "Anteprima animata non disponibile:": "Animierte Vorschau nicht verfügbar:",
    "Guarda 3 s": "3 s ansehen",
    "Guarda 3 secondi": "3 Sekunden ansehen",
    "Guarda 3 secondi del risultato (Spazio)": "3 Sekunden des Ergebnisses ansehen (Leertaste)",
    "Ferma": "Stopp",
    "Originale": "Original",
    "Risultato": "Ergebnis",
    "Originale / Risultato": "Original / Ergebnis",
    "Originale o risultato": "Original oder Ergebnis",
    "Tasto R": "Taste R",
    "Schermo intero": "Vollbild",
    "Schermo intero (F)": "Vollbild (F)",
    "Esci dallo schermo intero (Esc)": "Vollbild beenden (Esc)",
    "Schermo intero (Esc per uscire)": "Vollbild (Esc zum Beenden)",
    "Punto del video": "Stelle im Video",
    "Giorno": "Tag",
    "Notte": "Nacht",
    "Ovunque": "Überall",
    "Display non trovato": "Display nicht gefunden",
    "Zona disegnata a mano": "Von Hand gezeichneter Bereich",

    // ---------- striscia e taglio ----------
    "Copertura del video: con le frecce salti ai punti da controllare": "Abdeckung des Videos: mit den Pfeilen zu den zu prüfenden Stellen springen",
    "Clicca per andare in quel punto · frecce: salta ai punti da controllare": "Klicken, um dorthin zu gehen · Pfeile: zu den zu prüfenden Stellen springen",
    "[ Inizio qui": "[ Anfang hier",
    "Fine qui ]": "Ende hier ]",
    "Il video salvato inizia qui (tasto I)": "Das gespeicherte Video beginnt hier (Taste I)",
    "Il video salvato finisce qui (tasto O)": "Das gespeicherte Video endet hier (Taste O)",
    "Il pezzo deve durare almeno 1 secondo: l'inizio va prima della fine.":
      "Der Teil muss mindestens 1 Sekunde lang sein: der Anfang muss vor dem Ende liegen.",
    "Analisi del video… {n}%": "Video wird analysiert… {n}%",
    "Analisi non riuscita": "Analyse fehlgeschlagen",
    "Analisi non riuscita:": "Analyse fehlgeschlagen:",
    "Analisi…": "Analyse…",
    "Da analizzare": "Noch nicht analysiert",
    "Display trovato in tutto il video": "Display im ganzen Video gefunden",
    "Coperto": "Verdeckt",
    "Da controllare": "Prüfen",
    "Non trovato": "Nicht gefunden",
    "A mano": "Von Hand",
    "Segue": "Folgt",
    "1 tratto": "1 Abschnitt",
    "{n} tratti": "{n} Abschnitte",
    "1 zona": "1 Bereich",
    "{n} zone": "{n} Bereiche",
    "1 oggetto": "1 Objekt",
    "{n} oggetti": "{n} Objekte",
    "Tutto coperto": "Alles verdeckt",
    "1 tratto non trovato": "1 Abschnitt nicht gefunden",
    "{n} tratti non trovati": "{n} Abschnitte nicht gefunden",
    "1 tratto da controllare": "1 Abschnitt prüfen",
    "{n} tratti da controllare": "{n} Abschnitte prüfen",
    "Clicca sulla striscia o usa le frecce per andarci": "Klick auf den Streifen oder nutze die Pfeile, um dorthin zu gehen",
    "Copri a mano un tratto rosso": "Einen roten Abschnitt von Hand verdecken",
    "Non ci sono punti da controllare.": "Es gibt keine Stellen zu prüfen.",
    "Non ci sono altri punti da controllare più avanti.": "Weiter hinten gibt es keine Stellen mehr zu prüfen.",
    "Non ci sono punti da controllare prima di questo.": "Davor gibt es keine Stellen zu prüfen.",

    // ---------- pannello ----------
    "Solo questo video": "Nur dieses Video",
    "Zona": "Bereich",
    "Automatica": "Automatisch",
    "Regolata a mano": "Von Hand angepasst",
    "Regola…": "Anpassen…",
    "Zone a mano": "Bereiche von Hand",
    "Dove il display non viene trovato, disegni tu cosa coprire": "Wo das Display nicht gefunden wird, zeichnest du, was verdeckt wird",
    "Nessuna": "Keine",
    "Copri qui…": "Hier verdecken…",
    "Disegna una zona da coprire: ferma, o che segue un oggetto come una targa":
      "Zeichne einen Bereich zum Verdecken: fest, oder einem Objekt wie einem Nummernschild folgend",
    "Vai e modifica": "Hingehen und bearbeiten",
    "ferma": "fest",
    "segue": "folgt",
    "Parte": "Teil",
    "Tutto il video": "Ganzes Video",
    "Tutto": "Alles",
    "Per tutti i video": "Für alle Videos",
    "Preset": "Voreinstellungen",
    "+ Salva": "+ Speichern",
    "Usa queste impostazioni": "Diese Einstellungen verwenden",
    "Salva stile, forza, margine e display con un nome": "Stil, Stärke, Rand und Display mit einem Namen speichern",
    "Salva preset": "Voreinstellung speichern",
    "Stile, forza, margine e impostazioni del display vengono salvati con questo nome.":
      "Stil, Stärke, Rand und Display-Einstellungen werden mit diesem Namen gespeichert.",
    "Salva": "Speichern",
    "Nome": "Name",
    "Eliminare «{nome}»?": "«{nome}» löschen?",
    "Le impostazioni di adesso non cambiano.": "Deine aktuellen Einstellungen ändern sich nicht.",
    "Stile": "Stil",
    "Pixel": "Pixel",
    "Sfocato": "Unscharf",
    "Nero": "Schwarz",
    "Tinta": "Farbe",
    "Forza": "Stärke",
    "Margine": "Rand",
    "Piccolo": "Klein",
    "Normale": "Normal",
    "Grande": "Groß",
    "Manuale": "Manuell",
    "Margine a mano": "Rand von Hand",
    "margine {n}%": "Rand {n}%",
    "volti": "Gesichter",
    "Copri anche i volti": "Auch Gesichter verdecken",
    "Copre anche le facce delle persone viste di fronte": "Verdeckt auch die Gesichter von Personen, die von vorne zu sehen sind",
    "Più forza = quadrati più grandi.": "Mehr Stärke = größere Quadrate.",
    "Più forza = più sfocato.": "Mehr Stärke = unschärfer.",
    "Con «Guarda 3 s» vedi il risultato.": "Mit «3 s ansehen» siehst du das Ergebnis.",
    "Più forza = quadrati più grandi. Con «Guarda 3 s» vedi il risultato.":
      "Mehr Stärke = größere Quadrate. Mit «3 s ansehen» siehst du das Ergebnis.",
    "Salva in": "Speichern in",
    "Accanto al video": "Neben dem Video",
    "Salva accanto al video": "Neben dem Video speichern",
    "Cambia": "Ändern",
    "in tutto": "insgesamt",
    "Avvia": "Starten",
    "Avvia ({n} file)": "Starten ({n} Dateien)",

    // ---------- regola la zona ----------
    "Trascina o tira gli angoli": "Ziehen oder an den Ecken ziehen",
    "Con le frecce sposti, con Maiusc + frecce cambi la grandezza": "Pfeile verschieben, Umschalt + Pfeile ändern die Größe",
    "Vale per": "Gilt für",
    "Questo video": "Dieses Video",
    "Tutti i video": "Alle Videos",
    "Ripristina": "Zurücksetzen",
    "Annulla": "Abbrechen",
    "Applica": "Anwenden",
    "Elimina": "Löschen",
    "Dal": "Von",
    "al": "bis",
    "Mezzo secondo prima": "Eine halbe Sekunde früher",
    "Mezzo secondo dopo": "Eine halbe Sekunde später",
    "Inizio prima": "Anfang früher",
    "Inizio dopo": "Anfang später",
    "Fine prima": "Ende früher",
    "Fine dopo": "Ende später",
    "«Segue» va dietro all'oggetto che si muove, per esempio una targa":
      "«Folgt» geht dem sich bewegenden Objekt nach, zum Beispiel einem Nummernschild",
    "Qui il display non viene trovato: sposta il cursore su un punto verde della striscia, poi premi «Regola…».":
      "Hier wird das Display nicht gefunden: schieb den Regler auf eine grüne Stelle des Streifens und drück dann «Anpassen…».",

    // ---------- prima di esportare ----------
    "Alcuni punti non sono coperti": "Einige Stellen sind nicht verdeckt",
    "In «{nome}» c'è 1 tratto rosso: lì il display non viene trovato e la velocità resterebbe visibile.":
      "In «{nome}» gibt es 1 roten Abschnitt: dort wird das Display nicht gefunden und die Geschwindigkeit bliebe sichtbar.",
    "In «{nome}» ci sono {n} tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.":
      "In «{nome}» gibt es {n} rote Abschnitte: dort wird das Display nicht gefunden und die Geschwindigkeit bliebe sichtbar.",
    "In {n} video ci sono tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.":
      "{n} Videos haben rote Abschnitte: dort wird das Display nicht gefunden und die Geschwindigkeit bliebe sichtbar.",
    "Puoi controllarli e regolare la zona, oppure esportare lo stesso.": "Du kannst sie prüfen und den Bereich anpassen, oder trotzdem exportieren.",
    "Controlla": "Prüfen",
    "Esporta lo stesso": "Trotzdem exportieren",

    // ---------- elaborazione ----------
    "Elaborazione": "Verarbeitung",
    "Preparo…": "Vorbereitung…",
    "Avvio…": "Start…",
    "Sto lavorando…": "Ich arbeite…",
    "File {n} di {totale}": "Datei {n} von {totale}",
    "Fotogramma {n} di {totale}": "Bild {n} von {totale}",
    "{n} di {totale} fotogrammi": "{n} von {totale} Bildern",
    "Mancano circa {tempo}": "Noch etwa {tempo}",
    "Salvo il video…": "Video wird gespeichert…",
    "Puoi usare il computer mentre lavora.": "Du kannst den Computer weiter benutzen.",
    "Mostra dettagli": "Details anzeigen",
    "Nascondi dettagli": "Details ausblenden",
    "Interrompi": "Abbrechen",
    "Interruzione…": "Wird abgebrochen…",
    "Interrompere?": "Abbrechen?",
    "Il video in corso non verrà salvato. I file già finiti restano.": "Das aktuelle Video wird nicht gespeichert. Fertige Dateien bleiben.",
    "Continua": "Weiter",
    "Chiudere Velocità?": "Velocità schließen?",
    "Sta ancora lavorando: il video in corso non verrà salvato.": "Es arbeitet noch: das aktuelle Video wird nicht gespeichert.",
    "Chiudi": "Schließen",
    "Fatto": "Fertig",
    "Fatto in {tempo}": "Fertig in {tempo}",
    "Non riuscito": "Fehlgeschlagen",
    "Inizio:": "Start:",
    "Salvato:": "Gespeichert:",
    "Attenzione: display mai trovato in {nome}": "Achtung: Display in {nome} nie gefunden",
    "Errore con {nome}:": "Fehler bei {nome}:",
    "Interrotto dall'utente.": "Vom Benutzer abgebrochen.",

    // ---------- fine ----------
    "Fatto, ma controlla": "Fertig, aber bitte prüfen",
    "Non è andata": "Hat nicht geklappt",
    "Nessun file è stato creato.": "Es wurde keine Datei erstellt.",
    "In {nomi} non ho trovato il display.": "In {nomi} habe ich das Display nicht gefunden.",
    "In {nomi} alcuni tratti non sono coperti.": "In {nomi} sind einige Abschnitte nicht verdeckt.",
    "1 file non è stato elaborato (il motivo è qui sotto).": "1 Datei wurde nicht verarbeitet (der Grund steht unten).",
    "{n} file non sono stati elaborati (il motivo è qui sotto).": "{n} Dateien wurden nicht verarbeitet (der Grund steht unten).",
    "Con «Correggi» torni al video e lo sistemi.": "Mit «Korrigieren» gehst du zurück zum Video und korrigierst es.",
    "{nome} è nella cartella scelta.": "{nome} ist im gewählten Ordner.",
    "{nome} è accanto all'originale.": "{nome} liegt neben dem Original.",
    "{n} file pronti.": "{n} Dateien fertig.",
    "Tempo impiegato: {tempo}": "Benötigte Zeit: {tempo}",
    "Display non trovato: controlla": "Display nicht gefunden: bitte prüfen",
    "1 tratto non coperto": "1 Abschnitt nicht verdeckt",
    "{n} tratti non coperti": "{n} Abschnitte nicht verdeckt",
    "Correggi": "Korrigieren",
    "Apri": "Öffnen",
    "Apri video": "Video öffnen",
    "Apri foto": "Foto öffnen",
    "Mostra nella cartella": "Im Ordner zeigen",
    "Torna ai video": "Zurück zu den Videos",
    "Nuovi video": "Neue Videos",
    "Copia dettagli": "Details kopieren",
    "Copiato": "Kopiert",

    // ---------- errori ----------
    "Il disco è pieno: libera un po' di spazio e riprova.": "Die Festplatte ist voll: schaff etwas Platz und versuch es nochmal.",
    "Non ho il permesso di salvare in quella cartella: scegline un'altra in «Salva in».":
      "Ich darf in diesem Ordner nicht speichern: wähle einen anderen unter «Speichern in».",
    "Non trovo più il file: forse è stato spostato o il disco è stato scollegato.":
      "Ich finde die Datei nicht mehr: vielleicht wurde sie verschoben oder die Festplatte getrennt.",
    "Manca un pezzo dell'app (ffmpeg). Prova a reinstallare Velocità.": "Ein Teil der App fehlt (ffmpeg). Installiere Velocità neu.",
    "Il file sembra rovinato o incompleto. Prova a copiarlo di nuovo dalla videocamera.":
      "Die Datei scheint beschädigt oder unvollständig. Kopiere sie nochmal von der Kamera.",
    "In questa foto non trovo il display: prova a cambiare il colore in Impostazioni › Display.":
      "In diesem Foto finde ich das Display nicht: ändere die Farbe unter Einstellungen › Display.",
    "Non sono riuscito a salvare il video. Controlla che ci sia spazio sul disco e riprova.":
      "Ich konnte das Video nicht speichern. Prüfe, ob genug Platz auf der Festplatte ist, und versuch es nochmal.",
    "Qualcosa è andato storto con questo file.": "Mit dieser Datei ist etwas schiefgegangen.",
    "Errore interno di Velocità (non è colpa del video): clicca «Copia dettagli» e mandalo a chi fa l'app.":
      "Interner Fehler von Velocità (nicht wegen des Videos): klick auf «Details kopieren» und schick es an den Entwickler der App.",

    // ---------- impostazioni ----------
    "Impostazioni": "Einstellungen",
    "Impostazioni (⌘,)": "Einstellungen (⌘,)",
    "Impostazioni…": "Einstellungen…",
    "Generale": "Allgemein",
    "Come lavora Velocità.": "Wie Velocità arbeitet.",
    "Mostra i riquadri nel video": "Rahmen im Video zeigen",
    "Modalità prova: invece di pixelare, disegna nel video la zona trovata. Serve per controllare il rilevamento.":
      "Testmodus: statt zu verpixeln, zeichnet es den gefundenen Bereich ins Video. Damit prüfst du die Erkennung.",
    "Cartella sorvegliata": "Überwachter Ordner",
    "Con Velocità aperta, i video nuovi messi in questa cartella vengono coperti da soli (con le impostazioni di adesso).":
      "Solange Velocità offen ist, werden neue Videos in diesem Ordner automatisch verdeckt (mit den aktuellen Einstellungen).",
    "Smetti di sorvegliare": "Nicht mehr überwachen",
    "Scegli…": "Wählen…",
    "Cartella sorvegliata: 1 video nuovo": "Überwachter Ordner: 1 neues Video",
    "Cartella sorvegliata: {n} video nuovi": "Überwachter Ordner: {n} neue Videos",
    "Forza e margine della copertura si regolano a destra dell'anteprima, mentre guardi il video.":
      "Stärke und Rand der Abdeckung stellst du rechts neben der Vorschau ein, während du das Video ansiehst.",
    "Lingua": "Sprache",
    "La lingua cambia al prossimo avvio di Velocità.": "Die Sprache ändert sich beim nächsten Start von Velocità.",
    "Display": "Display",
    "Come l'app riconosce il display della moto.": "Wie die App das Motorrad-Display erkennt.",
    "Momento": "Tageszeit",
    "Automatico capisce da solo se il video è di giorno o di notte.": "Automatisch erkennt selbst, ob das Video bei Tag oder Nacht ist.",
    "Auto": "Auto",
    "Automatico": "Automatisch",
    "Colore del display": "Farbe des Displays",
    "Arancione": "Orange",
    "Rosso": "Rot",
    "Giallo": "Gelb",
    "Verde": "Grün",
    "Blu": "Blau",
    "Bianco": "Weiß",
    "Colore dal video": "Farbe aus dem Video",
    "Colore preso dal video": "Farbe aus dem Video",
    "Clicca sul display nell'anteprima: l'app usa quel colore.": "Klick in der Vorschau auf das Display: die App nimmt diese Farbe.",
    "Per prendere il colore dal video, prima aggiungi un video o una foto.": "Um die Farbe aus dem Video zu nehmen, füge zuerst ein Video oder Foto hinzu.",
    "Posizione del display": "Position des Displays",
    "In basso": "Unten",
    "«In basso» evita lampioni e finestre (consigliato). «Ovunque» se la videocamera è messa in un altro posto.":
      "«Unten» vermeidet Straßenlaternen und Fenster (empfohlen). «Überall», wenn die Kamera woanders montiert ist.",
    "Prestazioni": "Leistung",
    "Quanto del computer usa Velocità mentre lavora.": "Wie viel vom Computer Velocità beim Arbeiten nutzt.",
    "Uso CPU": "CPU-Nutzung",
    "Con meno CPU il computer resta più libero, ma ci mette di più.": "Mit weniger CPU bleibt der Computer freier, braucht aber länger.",
    "Quando è possibile il video viene creato con il chip del Mac o con la scheda video su Windows (NVIDIA, Intel, AMD): è molto più veloce.":
      "Wenn möglich wird das Video mit dem Mac-Chip oder unter Windows mit der Grafikkarte erstellt (NVIDIA, Intel, AMD): das ist viel schneller.",
    "Aggiornamenti": "Updates",
    "Controlla all'avvio": "Beim Start prüfen",
    "Le versioni nuove arrivano da GitHub.": "Neue Versionen kommen von GitHub.",
    "Versione": "Version",
    "Versione {versione}": "Version {versione}",
    "Controlla ora": "Jetzt prüfen",
    "Controllo…": "Wird geprüft…",
    "Controllo non riuscito": "Prüfung fehlgeschlagen",
    "Hai l'ultima versione": "Du hast die neueste Version",
    "Disponibile la {versione}": "{versione} verfügbar",
    "È disponibile una nuova versione": "Eine neue Version ist verfügbar",
    "È disponibile la versione {versione}": "Version {versione} ist verfügbar",
    "Aggiorna": "Aktualisieren",
    "Più tardi": "Später",
    "Riavvio…": "Neustart…",
    "Riprova": "Nochmal versuchen",
    "Aggiornamento non riuscito:": "Update fehlgeschlagen:",

    // ---------- scegli il colore dal video ----------
    "Clicca sul display della moto": "Klick auf das Motorrad-Display",
    "Clicca sulla parte accesa del display. L'app cercherà quel colore in tutti i video.":
      "Klick auf den leuchtenden Teil des Displays. Die App sucht diese Farbe in allen Videos.",
    "Sposta il cursore per trovare un punto dove il display si vede bene.": "Schieb den Regler an eine Stelle, wo das Display gut zu sehen ist.",
    "Qui è troppo scuro: clicca sulla parte accesa del display": "Hier ist es zu dunkel: klick auf den leuchtenden Teil des Displays",
    "Colore scelto": "Gewählte Farbe",
    "Usa questo colore": "Diese Farbe verwenden",

    // ---------- menu e scorciatoie ----------
    "Controlla aggiornamenti…": "Nach Updates suchen…",
    "Aggiungi video o foto…": "Videos oder Fotos hinzufügen…",
    "Aggiungi una cartella…": "Einen Ordner hinzufügen…",
    "Aggiungi video o foto": "Videos oder Fotos hinzufügen",
    "Aggiungi una cartella": "Einen Ordner hinzufügen",
    "Modifica": "Bearbeiten",
    "Finestra": "Fenster",
    "Aiuto": "Hilfe",
    "Regola la zona…": "Bereich anpassen…",
    "Copri a mano qui…": "Hier von Hand verdecken…",
    "Inizio del pezzo qui": "Anfang des Teils hier",
    "Fine del pezzo qui": "Ende des Teils hier",
    "Scorciatoie da tastiera": "Tastenkürzel",
    "Un secondo avanti o indietro (con ⇧ 10 secondi)": "Eine Sekunde vor oder zurück (mit ⇧ 10 Sekunden)",
    "Frecce sulla striscia: al prossimo punto da controllare": "Pfeile auf dem Streifen: zur nächsten zu prüfenden Stelle",
    "Inizio e fine del pezzo da salvare": "Anfang und Ende des zu speichernden Teils",
    "Spazio": "Leertaste",
    "Cambia l'ordine della coda": "Reihenfolge der Liste ändern",
    "Regola la zona: frecce per spostare, ⇧ + frecce per la grandezza, ↩ per applicare, Esc per annullare":
      "Bereich anpassen: Pfeile zum Verschieben, ⇧ + Pfeile für die Größe, ↩ zum Anwenden, Esc zum Abbrechen",

    // ---------- persone e targhe ----------
    "Persone": "Personen",
    "Copre le facce viste di fronte. L'esportazione è più lenta.": "Verdeckt Gesichter, die von vorne zu sehen sind. Der Export dauert länger.",
    "Targhe": "Nummernschilder",
    "Con «Copri qui…» › «Segue» disegni la zona sulla targa e la segue.": "Mit «Hier verdecken…» › «Folgt» zeichnest du den Bereich auf das Schild und er folgt ihm.",
    "persone": "Personen",
    "targhe": "Nummernschilder",
    "segue · spenta": "folgt · aus",
    // ---------- grafica nuova e tratti da controllare ----------
    "1 tratto «Va bene così»": "1 Abschnitt «Passt so»",
    "{n} tratti «Va bene così»": "{n} Abschnitte «Passt so»",
    "Va bene così": "Passt so",
    "Copri a mano": "Von Hand verdecken",
    "Qui non c'è niente da coprire: il tratto diventa verde": "Hier gibt es nichts zu verdecken: der Abschnitt wird grün",
    "Disegna tu la zona da coprire in questo tratto": "Zeichne selbst den Bereich, der in diesem Abschnitt verdeckt wird",
    "Tutto verde: non c'è niente da controllare.": "Alles grün: es gibt nichts zu prüfen.",
    "Tratto prima": "Vorheriger Abschnitt",
    "Tratto dopo": "Nächster Abschnitt",
    "{n} di {totale}": "{n} von {totale}",
    "Aspetto": "Darstellung",
    "Come appare Velocità.": "Wie Velocità aussieht.",
    "Tema": "Design",
    "Chiaro": "Hell",
    "Scuro": "Dunkel",
    "Miniature nella lista dei video": "Vorschaubilder in der Videoliste",
    "Mostra un fotogramma accanto a ogni video invece dell'icona.": "Zeigt neben jedem Video ein Bild statt des Symbols.",
    "Mostra «Fatti di recente»": "«Zuletzt erledigt» anzeigen",
    "Gli ultimi video coperti nella schermata iniziale.": "Die zuletzt verdeckten Videos auf dem Startbildschirm.",
    "Rivedi «Come funziona»": "«So funktioniert es» nochmal ansehen",
    "Come funziona": "So funktioniert es",
    "Salta": "Überspringen",
    "Avanti": "Weiter",
    "Inizia": "Los geht's",
    "Trascina i video della moto": "Zieh die Motorradvideos hinein",
    "Velocità trova il display in ogni fotogramma e copre il numero della velocità. I video restano sul tuo computer.": "Velocità findet das Display in jedem Bild und verdeckt die Geschwindigkeitszahl. Die Videos bleiben auf deinem Computer.",
    "La striscia ti dice dove guardare": "Der Streifen zeigt dir, wo du hinschauen musst",
    "Verde: coperto. Arancione e rosso: da controllare. Con le frecce vai a ogni tratto: «Va bene così» o «Copri a mano», e diventa verde.": "Grün: verdeckt. Orange und Rot: prüfen. Mit den Pfeilen gehst du zu jedem Abschnitt: «Passt so» oder «Von Hand verdecken», und er wird grün.",
    "Avvia e il video è pronto": "Starten, und das Video ist fertig",
    "Il video coperto arriva accanto all'originale, con «_speed_blur» nel nome. Lo apri subito in DaVinci.": "Das verdeckte Video liegt neben dem Original, mit «_speed_blur» im Namen. Du kannst es sofort in DaVinci öffnen.",
    "Fatti di recente": "Zuletzt erledigt",
    "Svuota": "Leeren",
    "oggi": "heute",
    "ieri": "gestern",
    "Il numero della velocità viene coperto da solo. Anche facce e targhe, se vuoi.": "Die Geschwindigkeitszahl wird automatisch verdeckt. Auf Wunsch auch Gesichter und Nummernschilder.",
    "Scegli i video…": "Videos wählen…",
    "Scegli una cartella": "Einen Ordner wählen",
    "MP4, MOV, MKV, AVI e foto JPG, PNG, WEBP · tutto resta sul tuo computer": "MP4, MOV, MKV, AVI und Fotos JPG, PNG, WEBP · alles bleibt auf deinem Computer",
    "Confronto originale e risultato": "Original und Ergebnis vergleichen",
    "Trascina per confrontare": "Ziehen zum Vergleichen",
    "Trascina per confrontare (tasto R: tutto originale o tutto risultato)": "Ziehen zum Vergleichen (Taste R: ganz Original oder ganz Ergebnis)",
    "Trascina: dove inizia il video salvato": "Ziehen: wo das gespeicherte Video beginnt",
    "Trascina: dove finisce il video salvato": "Ziehen: wo das gespeicherte Video endet",
  },
};

// la lingua usata adesso: "it", "en" o "de"
let lingua = "it";

// sceglie la lingua: "auto" = quella del computer
function scegliLingua(scelta) {
  if (scelta === "it" || scelta === "en" || scelta === "de") {
    lingua = scelta;
    return;
  }
  const delComputer = (navigator.language || "it").slice(0, 2).toLowerCase();
  if (delComputer === "it" || delComputer === "de" || delComputer === "en") {
    lingua = delComputer;
  } else {
    lingua = "en"; // le altre lingue: inglese, che capiscono in tanti
  }
}

// il testo nella lingua scelta, con i valori al posto delle {graffe}
function t(testo, valori) {
  let tradotto = testo;
  const dizionario = TRADUZIONI[lingua];
  if (dizionario && dizionario[testo] !== undefined) {
    tradotto = dizionario[testo];
  }
  if (valori) {
    for (const nome in valori) {
      tradotto = tradotto.split("{" + nome + "}").join(String(valori[nome]));
    }
  }
  return tradotto;
}

// gli attributi che si vedono (fumetti e lettori di schermo)
const ATTRIBUTI_DA_TRADURRE = ["title", "aria-label", "alt"];

// traduce una scritta (tiene gli spazi prima e dopo com'erano)
function traduciTesto(testo) {
  const pulito = testo.replace(/\s+/g, " ").trim();
  if (pulito === "") {
    return testo;
  }
  const tradotto = t(pulito);
  if (tradotto === pulito) {
    return testo; // non c'è nel dizionario: resta com'è
  }
  const prima = testo.match(/^\s*/)[0];
  const dopo = testo.match(/\s*$/)[0];
  return prima + tradotto + dopo;
}

// traduce un pezzo di pagina: le scritte e gli attributi
function traduciDentro(radice) {
  if (radice.nodeType === Node.TEXT_NODE) {
    const nuovo = traduciTesto(radice.nodeValue);
    if (nuovo !== radice.nodeValue) {
      radice.nodeValue = nuovo;
    }
    return;
  }
  if (radice.nodeType !== Node.ELEMENT_NODE) {
    return;
  }
  const elementi = [radice, ...radice.querySelectorAll("*")];
  for (const el of elementi) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") {
      continue;
    }
    for (const nome of ATTRIBUTI_DA_TRADURRE) {
      const valore = el.getAttribute(nome);
      if (valore) {
        const nuovo = traduciTesto(valore);
        if (nuovo !== valore) {
          el.setAttribute(nome, nuovo);
        }
      }
    }
    for (const figlio of el.childNodes) {
      if (figlio.nodeType === Node.TEXT_NODE) {
        const nuovo = traduciTesto(figlio.nodeValue);
        if (nuovo !== figlio.nodeValue) {
          figlio.nodeValue = nuovo;
        }
      }
    }
  }
}

// traduce tutta la finestra e poi ogni cosa che l'app cambia
function traduciPagina() {
  document.documentElement.lang = lingua;
  if (lingua === "it") {
    return; // la pagina è già in italiano
  }
  traduciDentro(document.body);
  const osservatore = new MutationObserver((cambiamenti) => {
    for (const c of cambiamenti) {
      if (c.type === "childList") {
        for (const nodo of c.addedNodes) {
          traduciDentro(nodo);
        }
      } else if (c.type === "characterData") {
        traduciDentro(c.target);
      } else if (c.type === "attributes") {
        traduciDentro(c.target);
      }
    }
  });
  osservatore.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRIBUTI_DA_TRADURRE,
  });
}
