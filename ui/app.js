// Velocità: la parte della finestra (bottoni, schermate, anteprima).
// Il lavoro vero lo fa Rust: qui lo chiamiamo con invoke().

const tauri = window.__TAURI__;
const invoke = tauri.core.invoke;

// sul Mac la barra in alto lascia posto ai tre pallini della finestra
if (navigator.userAgent.includes("Mac")) {
  document.documentElement.classList.add("mac");
}

// ==========================================
// DATI DELL'APP
// ==========================================

// file da elaborare (si possono trascinare più file insieme)
let coda = [];
// quale file della coda si vede nell'anteprima
let indiceAnteprima = 0;
// true mentre sta elaborando
let alLavoro = false;
// l'aggiornamento trovato (se c'è)
let aggiornamento = null;
// risultati dell'ultimo giro (per i bottoni della schermata finale)
let ultimiRisultati = [];
// serve a ignorare le anteprime vecchie se l'utente sposta veloce il cursore
let numeroAnteprima = 0;
let timerAnteprima = null;
// quando è partita l'elaborazione (per chiedere conferma prima di interrompere)
let inizioLavoro = 0;
// true se sul Mac c'è il menu in alto (allora ⌘O e ⌘, li fa il menu)
let menuAttivo = false;
// il testo completo dell'ultimo errore (per «Copia dettagli»)
let dettagliErrore = "";

// le scelte dell'utente, salvate per la prossima volta
const scelte = {
  cartella: "",          // "" = accanto al video
  usoCpu: "auto",        // auto, 0.25, 0.5, 0.75, 1
  forza: 10,             // dimensione dei blocchi della pixelatura
  margine: 0.15,         // margine attorno al cruscotto
  margineManuale: false, // true = margine scelto con la barra (da 0 a 50%)
  stile: "pixel",        // pixel, sfocatura, nero, tinta
  momento: "auto",       // auto, giorno, notte
  colore: "arancione",   // arancione, rosso, giallo, verde, blu, bianco, video
  coloreVideo: [255, 140, 26], // il colore preso cliccando sul display (con "video")
  posizione: "basso",    // basso, ovunque: dove cercare il display
  controllaAggiornamenti: true,
  pannelloTutti: true,   // la parte "Per tutti i video" del pannello è aperta
  volti: false,         // copre anche le facce delle persone
  lingua: "auto",       // "auto" (quella del computer), "it", "en" o "de"
  tema: "auto",         // "auto" (come il Mac), "chiaro" o "scuro"
  miniature: true,      // un fotogramma accanto a ogni video nella lista
  recenti: true,        // "Fatti di recente" nella schermata iniziale
  guidaVista: false,    // "Come funziona" è già stato mostrato
  cartellaSorvegliata: "", // i video nuovi messi qui si coprono da soli ("" = nessuna)
};

function caricaScelte() {
  try {
    const salvate = JSON.parse(localStorage.getItem("scelte") || "{}");
    Object.assign(scelte, salvate);
  } catch (e) {
    // se qualcosa non va, si tengono quelle di partenza
  }
}

function salvaScelte() {
  try {
    localStorage.setItem("scelte", JSON.stringify(scelte));
  } catch (e) {
    // non importa se non si riesce a salvare
  }
}

// ==========================================
// PICCOLI AIUTI
// ==========================================

function $(id) {
  return document.getElementById(id);
}

// mostra una schermata e nasconde le altre
function mostraSchermata(nome) {
  if (nome !== "corso") {
    togliBarraDock();
  }
  if (nome === "inizio") {
    disegnaRecenti();
  }
  if (nome !== "pronto" && schermoIntero) {
    cambiaSchermoIntero();
  }
  const tutte = ["inizio", "pronto", "corso", "finito", "impostazioni", "scegli"];
  for (const s of tutte) {
    $("schermata-" + s).classList.toggle("nascosto", s !== nome);
  }
  // scritta grigia accanto a "Velocità" nella barra in alto
  const sottotitoli = {
    inizio: "",
    pronto: testoCoda(),
    corso: "Elaborazione",
    finito: "Fatto",
    impostazioni: "Impostazioni",
    scegli: "Colore dal video",
  };
  $("barra-sottotitolo").textContent = sottotitoli[nome];
  if (nome !== "pronto") {
    fermaAnimazione();
  }
  // mentre lavora le impostazioni non si aprono
  $("btn-impostazioni").disabled = nome === "corso";
}

// true se si vede questa schermata
function suSchermata(nome) {
  return !$("schermata-" + nome).classList.contains("nascosto");
}

// ==========================================
// DOMANDA AL CENTRO DELLA FINESTRA
// ==========================================

// la risposta della domanda aperta (null = nessuna domanda aperta)
let rispostaDialogo = null;

// chiedi("Interrompere?", "Il video non verrà salvato.", "Interrompi", "Continua")
// restituisce una Promise: true se premi il primo bottone, false se l'altro.
// Con no = "" c'è un bottone solo (serve per dare un'informazione).
function chiedi(titolo, testo, si, no) {
  $("dialogo-titolo").textContent = titolo;
  $("dialogo-testo").textContent = testo;
  $("dialogo-si").textContent = si;
  $("dialogo-no").textContent = no;
  $("dialogo-no").classList.toggle("nascosto", !no);
  $("dialogo").classList.remove("nascosto");
  $("dialogo-si").focus();
  return new Promise((risolvi) => {
    rispostaDialogo = risolvi;
  });
}

// come chiedi, ma con una casella per scrivere (es. il nome di un preset).
// Restituisce il testo scritto, oppure null se annulli.
async function chiediNome(titolo, testo, si, valore) {
  const promessa = chiedi(titolo, testo, si, "Annulla");
  const campo = $("dialogo-campo");
  campo.value = valore;
  campo.classList.remove("nascosto");
  campo.focus();
  campo.select();
  const ok = await promessa;
  const nome = campo.value.trim();
  return ok && nome !== "" ? nome : null;
}

function chiudiDialogo(risposta) {
  if (!rispostaDialogo) {
    return;
  }
  $("dialogo").classList.add("nascosto");
  $("dialogo-campo").classList.add("nascosto");
  const risolvi = rispostaDialogo;
  rispostaDialogo = null;
  risolvi(risposta);
}

// ==========================================
// ERRORI IN PAROLE SEMPLICI
// ==========================================

// l'errore di Rust o di ffmpeg -> una frase che si capisce
function erroreSemplice(errore) {
  const testo = String(errore).toLowerCase();
  if (testo.includes("no space") || testo.includes("os error 28") || testo.includes("disk full")) {
    return "Il disco è pieno: libera un po' di spazio e riprova.";
  }
  if (testo.includes("permission denied") || testo.includes("os error 13") || testo.includes("not permitted") || testo.includes("os error 1)")) {
    return "Non ho il permesso di salvare in quella cartella: scegline un'altra in «Salva in».";
  }
  if (testo.includes("no such file") || testo.includes("os error 2)") || testo.includes("cannot find")) {
    return "Non trovo più il file: forse è stato spostato o il disco è stato scollegato.";
  }
  if (testo.includes("avviare ffmpeg")) {
    return "Manca un pezzo dell'app (ffmpeg). Prova a reinstallare Velocità.";
  }
  if (testo.includes("non sembra un video") || testo.includes("invalid data") || testo.includes("moov atom") || testo.includes("nessun fotogramma") || testo.includes("leggere")) {
    return "Il file sembra rovinato o incompleto. Prova a copiarlo di nuovo dalla videocamera.";
  }
  if (testo.includes("display in questa foto")) {
    return "In questa foto non trovo il display: prova a cambiare il colore in Impostazioni › Display.";
  }
  if (testo.includes("ffmpeg")) {
    return "Non sono riuscito a salvare il video. Controlla che ci sia spazio sul disco e riprova.";
  }
  if (testo.includes("panicked")) {
    return "Errore interno di Velocità (non è colpa del video): clicca «Copia dettagli» e mandalo a chi fa l'app.";
  }
  return "Qualcosa è andato storto con questo file.";
}

// copia il testo negli appunti (per mandarlo a chi ti aiuta)
async function copiaDettagli() {
  try {
    await navigator.clipboard.writeText(dettagliErrore);
  } catch (e) {
    // se gli appunti non si possono usare, si fa alla vecchia maniera
    const area = document.createElement("textarea");
    area.value = dettagliErrore;
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
  $("btn-copia").querySelector("span").textContent = "Copiato";
  setTimeout(() => {
    $("btn-copia").querySelector("span").textContent = "Copia dettagli";
  }, 1500);
}

// "1 video", "3 video", "2 foto", "4 file"
function testoCoda() {
  const video = coda.filter((f) => !f.foto).length;
  const foto = coda.length - video;
  if (foto === 0) {
    return t("{n} video", { n: video });
  }
  if (video === 0) {
    return t("{n} foto", { n: foto });
  }
  return t("{n} file", { n: coda.length });
}

// codice HTML di un'icona (sono tutte in index.html)
function icona(nome) {
  return '<svg class="icona"><use href="#i-' + nome + '"/></svg>';
}

// una riga della lista dei file: icona, nome, testo piccolo sotto
function creaRigaFile(tag, file, meta) {
  const riga = document.createElement(tag);
  riga.className = "riga-file";
  // con la miniatura (se c'è e se è scelta), altrimenti l'icona
  const miniatura = scelte.miniature ? scegliMiniatura(file) : null;
  const figura = miniatura ? '<img class="miniatura-riga" alt="" src="' + miniatura + '">' : icona(file.foto ? "foto" : "video");
  riga.innerHTML = figura + '<span class="testi"><span class="nome"></span><span class="meta"></span></span>';
  riga.querySelector(".nome").textContent = file.nome;
  riga.querySelector(".meta").textContent = meta;
  return riga;
}

// la miniatura di un file per la lista: un fotogramma verso metà video
function scegliMiniatura(file) {
  if (!file || !file.miniature || file.miniature.length === 0) {
    return null;
  }
  return file.miniature[Math.floor(file.miniature.length / 2)];
}

// 75 secondi -> "1:15"
function formattaTempo(secondi) {
  secondi = Math.max(0, Math.round(secondi));
  const ore = Math.floor(secondi / 3600);
  const minuti = Math.floor((secondi % 3600) / 60);
  const sec = String(secondi % 60).padStart(2, "0");
  if (ore > 0) {
    return ore + ":" + String(minuti).padStart(2, "0") + ":" + sec;
  }
  return minuti + ":" + sec;
}

// 2130 -> "2.130"
function formattaNumero(n) {
  return n.toLocaleString("it-CH").replace(/[’']/g, ".");
}

function nomeDaPercorso(percorso) {
  return percorso.split(/[\\/]/).pop();
}

function scriviRegistro(testo) {
  const ora = new Date().toLocaleTimeString("it-CH");
  $("registro").textContent += "[" + ora + "] " + testo + "\n";
  $("registro").scrollTop = $("registro").scrollHeight;
}

function valoreUsoCpu() {
  if (scelte.usoCpu === "auto") {
    return 0.5; // Auto = 50%, lascia metà dei core liberi
  }
  return Number(scelte.usoCpu);
}

// le scelte del display da mandare a Rust
function sceltaDisplay(file) {
  return {
    // zona spostata o ingrandita a mano per questo file (null = automatica)
    regolazione: file && file.regolazione ? file.regolazione : null,
    momento: scelte.momento,
    colore: scelte.colore,
    rgb: scelte.coloreVideo,
    posizione: scelte.posizione,
    stile: scelte.stile,
    volti: scelte.volti,
  };
}

// nome e colore del pallino per ogni colore del display
const NOMI_COLORI = {
  arancione: "Arancione",
  rosso: "Rosso",
  giallo: "Giallo",
  verde: "Verde",
  blu: "Blu",
  bianco: "Bianco",
  video: "Colore dal video",
};
const PALLINI_COLORI = {
  arancione: "#ff8c1a",
  rosso: "#ff3b30",
  giallo: "#ffd60a",
  verde: "#30d158",
  blu: "#0a84ff",
  bianco: "#ffffff",
};

// la scritta piccola nell'anteprima, es. "Notte · Arancione"
function mostraInfoAnteprima(risposta) {
  let testo;
  if (risposta.fissa) {
    testo = "Zona disegnata a mano";
  } else if (risposta.zona) {
    const momento = risposta.momento === "giorno" ? "Giorno" : "Notte";
    testo = t(momento) + " · " + t(NOMI_COLORI[scelte.colore]);
    if (scelte.posizione === "ovunque") {
      testo = testo + " · " + t("Ovunque");
    }
  } else {
    testo = "Display non trovato";
  }
  let pallino = PALLINI_COLORI[scelte.colore];
  if (scelte.colore === "video") {
    pallino = rgbInTesto(scelte.coloreVideo);
  }
  $("info-testo").textContent = testo;
  $("info-pallino").style.background = pallino;
  $("anteprima-info").classList.remove("nascosto");
}

// [255, 140, 26] -> "rgb(255,140,26)"
function rgbInTesto(rgb) {
  return "rgb(" + rgb.join(",") + ")";
}

// segna come attivo il bottone giusto di una scelta a segmenti
function aggiornaSegmentato(idContenitore, valore) {
  for (const b of $(idContenitore).querySelectorAll("button")) {
    b.classList.toggle("attivo", b.dataset.valore === String(valore));
  }
}

// ==========================================
// 1. SCEGLIERE I FILE
// ==========================================

const ESTENSIONI = ["mp4", "mov", "avi", "mkv", "m4v", "jpg", "jpeg", "png", "webp"];

// sceglie una cartella intera: tutti i video e le foto che contiene
async function scegliCartella() {
  const cartella = await tauri.dialog.open({ directory: true });
  if (cartella) {
    aggiungiFile([cartella]);
  }
}

async function scegliFile() {
  const scelti = await tauri.dialog.open({
    multiple: true,
    filters: [{ name: "Video e foto", extensions: ESTENSIONI }],
  });
  if (scelti) {
    aggiungiFile(Array.isArray(scelti) ? scelti : [scelti]);
  }
}

async function aggiungiFile(percorsi) {
  if (alLavoro) {
    return;
  }
  if (regolazioneAperta) {
    chiudiRegolazione();
  }
  // le cartelle diventano i video e le foto che contengono
  percorsi = await invoke("espandi_percorsi", { percorsi: percorsi });
  // tiene solo i file con un'estensione giusta
  const validi = percorsi.filter((p) => {
    const estensione = p.split(".").pop().toLowerCase();
    return ESTENSIONI.includes(estensione);
  });
  if (validi.length === 0) {
    mostraErrore("Nessun file da usare", "Scegli un video (MP4, MOV, MKV, AVI) o una foto (JPG, PNG, WEBP), o una cartella che li contiene.");
    return;
  }

  // se si arriva dalla schermata iniziale o finale, si ricomincia la coda
  const schermataPronto = !$("schermata-pronto").classList.contains("nascosto");
  if (!schermataPronto) {
    coda = [];
  }

  for (const percorso of validi) {
    if (coda.some((f) => f.percorso === percorso)) {
      continue; // già in coda
    }
    try {
      const info = await invoke("info_file", { percorso: percorso });
      coda.push({ percorso: percorso, nome: info.nome, foto: info.foto, durata: info.durata });
    } catch (errore) {
      scriviRegistro(nomeDaPercorso(percorso) + ": " + errore);
      if (validi.length === 1) {
        mostraErrore("Non riesco ad aprire il file", erroreSemplice(errore), String(errore));
        return;
      }
    }
  }
  if (coda.length === 0) {
    return;
  }

  indiceAnteprima = Math.min(indiceAnteprima, coda.length - 1);
  aggiornaSchedaFile();
  mostraSchermata("pronto");
  caricaAnteprima();
  analizzaSeServe();
}

// ==========================================
// 2. SCHERMATA PRONTO
// ==========================================

function aggiornaSchedaFile() {
  const primo = coda[indiceAnteprima];
  const tuttiFoto = coda.every((f) => f.foto);

  disegnaCoda();
  disegnaZoneFisse();

  // durata totale dei video (o dei pezzi scelti), sopra il bottone Avvia
  let durata = 0;
  for (const f of coda) {
    if (!f.foto) {
      durata += f.taglio ? f.taglio.fine - f.taglio.inizio : f.durata;
    }
  }
  let riepilogo = testoCoda();
  if (durata > 0) {
    riepilogo += " · " + formattaTempo(durata) + (coda.length > 1 ? " " + t("in tutto") : "");
  }
  $("testo-riepilogo").textContent = riepilogo;
  $("barra-sottotitolo").textContent = testoCoda();

  $("testo-zona").textContent = primo.regolazione ? "Regolata a mano" : "Automatica";
  aggiornaTaglio();
  aggiornaCopertura();
  aggiornaTempoCursore();
  $("btn-animazione").classList.toggle("nascosto", primo.foto);
  disegnaStriscia();

  $("nome-cartella").textContent = scelte.cartella ? nomeDaPercorso(scelte.cartella) : "Accanto al video";
  $("btn-reset-cartella").classList.toggle("nascosto", !scelte.cartella);
  $("btn-avvia").textContent = coda.length > 1 ? t("Avvia ({n} file)", { n: coda.length }) : "Avvia";
  $("btn-apri").textContent = tuttiFoto ? "Apri foto" : "Apri video";

  // con una foto il cursore dell'anteprima non serve
  $("linea-tempo").classList.toggle("nascosto", primo.foto);
  disegnaFotogrammi(primo);
  $("sotto-cursore").classList.toggle("nascosto", primo.foto);
}

// "Per tutti i video": aperto o chiuso (chiuso mostra un riassunto)
function aggiornaPannelloTutti() {
  const aperto = scelte.pannelloTutti;
  $("btn-per-tutti").setAttribute("aria-expanded", String(aperto));
  $("gruppo-tutti").classList.toggle("nascosto", !aperto);
  const stili = { pixel: "Pixel", sfocatura: "Sfocato", nero: "Nero", tinta: "Tinta" };
  let riassunto = t(stili[scelte.stile]);
  if (scelte.stile === "pixel" || scelte.stile === "sfocatura") {
    riassunto += " " + scelte.forza + " px";
  }
  riassunto += " · " + t("margine {n}%", { n: Math.round(scelte.margine * 100) });
  if (scelte.volti) {
    riassunto += " · " + t("volti");
  }
  $("riassunto-tutti").textContent = aperto ? "" : riassunto;
  // il preset uguale alle scelte di adesso si colora
  const chips = $("lista-preset").querySelectorAll(".chip:not(.aggiungi)");
  caricaPreset().forEach((preset, i) => {
    if (chips[i]) {
      chips[i].classList.toggle("attivo", presetUguale(preset));
    }
  });
}

// lo stato dell'analisi di un file, per la lista: pallino e parole
function statoFile(file) {
  if (file.foto) {
    return null;
  }
  const c = file.copertura;
  if (!c || !c.finito) {
    const testo = analisiInCorso === file.percorso ? t("Analisi…") : t("Da analizzare");
    return { classe: "attesa", testo: testo };
  }
  if (c.errore) {
    return { classe: "attesa", testo: t("Analisi non riuscita") };
  }
  const rossi = trattiNelTaglio(file, 0);
  if (rossi > 0) {
    return { classe: "rosso", testo: rossi === 1 ? t("1 tratto non trovato") : t("{n} tratti non trovati", { n: rossi }) };
  }
  const arancioni = trattiNelTaglio(file, 1);
  if (arancioni > 0) {
    return { classe: "ambra", testo: arancioni === 1 ? t("1 tratto da controllare") : t("{n} tratti da controllare", { n: arancioni }) };
  }
  return { classe: "verde", testo: t("Tutto coperto") };
}

function disegnaCoda() {
  const lista = $("lista-coda");
  lista.innerHTML = "";
  coda.forEach((file, i) => {
    if (scelte.miniature) {
      chiediMiniature(file); // arrivano dopo, una alla volta
    }
    let meta = file.foto ? "Foto" : formattaTempo(file.durata);
    if (file.taglio) {
      meta = formattaTempo(file.taglio.inizio) + " – " + formattaTempo(file.taglio.fine);
    }
    const riga = creaRigaFile("button", file, meta);
    riga.dataset.indice = i;
    riga.title = "Trascina per cambiare l'ordine (⌥↑ ⌥↓) · Canc per togliere";
    // la maniglia ⋮⋮ fa capire che la riga si può spostare
    riga.insertAdjacentHTML("afterbegin", '<svg class="icona maniglia-riga"><use href="#i-maniglia"/></svg>');
    // pallino e parole: come va l'analisi di questo video
    const stato = statoFile(file);
    if (stato) {
      const testoMeta = riga.querySelector(".meta");
      testoMeta.textContent = t(meta) + " · " + stato.testo;
      testoMeta.insertAdjacentHTML("afterbegin", '<i class="pallino-stato ' + stato.classe + '"></i>');
    }
    if (i === indiceAnteprima) {
      riga.classList.add("attivo");
    }
    // tenendo premuto e trascinando si cambia l'ordine
    riga.addEventListener("pointerdown", (evento) => iniziaTrascinaRiga(evento, riga));

    const togli = document.createElement("span");
    togli.className = "bottone-icona piccolo";
    togli.innerHTML = icona("x");
    togli.title = "Togli dalla coda";
    togli.setAttribute("aria-hidden", "true");
    togli.addEventListener("click", (evento) => {
      evento.stopPropagation();
      togliDallaCoda(i);
    });
    riga.appendChild(togli);

    // clic su un file = lo mostra nell'anteprima
    riga.addEventListener("click", () => {
      if (rigaAppenaSpostata) {
        rigaAppenaSpostata = false; // era un trascinamento, non un clic
        return;
      }
      indiceAnteprima = i;
      aggiornaSchedaFile();
      caricaAnteprima();
      analizzaSeServe();
    });
    lista.appendChild(riga);
  });
}

function togliDallaCoda(indice) {
  coda.splice(indice, 1);
  if (coda.length === 0) {
    mostraSchermata("inizio");
    return;
  }
  indiceAnteprima = Math.min(indiceAnteprima, coda.length - 1);
  aggiornaSchedaFile();
  analizzaSeServe();
  caricaAnteprima();
}

// mette il riquadro rosso nel punto giusto sopra l'immagine
function posizionaZona(img, zonaDiv, zona) {
  if (!zona || !img.naturalWidth) {
    zonaDiv.classList.add("nascosto");
    return;
  }
  const g = geometriaImmagine(img);
  zonaDiv.style.left = g.sinistra + zona.x * g.larghezza + "px";
  zonaDiv.style.top = g.sopra + zona.y * g.altezza + "px";
  zonaDiv.style.width = zona.w * g.larghezza + "px";
  zonaDiv.style.height = zona.h * g.altezza + "px";
  zonaDiv.classList.remove("nascosto");
}

// l'immagine è "contain": dove finisce davvero dentro il riquadro nero.
// Usa clientWidth (la grandezza senza l'ingrandimento della regolazione).
function geometriaImmagine(img) {
  const scala = Math.min(img.clientWidth / img.naturalWidth, img.clientHeight / img.naturalHeight);
  const larghezza = img.naturalWidth * scala;
  const altezza = img.naturalHeight * scala;
  return {
    sinistra: (img.clientWidth - larghezza) / 2,
    sopra: (img.clientHeight - altezza) / 2,
    larghezza: larghezza,
    altezza: altezza,
  };
}

let ultimaAnteprima = null;

async function caricaAnteprima() {
  const file = coda[indiceAnteprima];
  if (!file) {
    return;
  }
  fermaAnimazione();
  numeroAnteprima++;
  const mioNumero = numeroAnteprima;
  const posizione = Number($("cursore-anteprima").value) / 1000;

  $("anteprima-carico").textContent = "Carico l'anteprima…";
  $("anteprima-carico").classList.remove("nascosto");

  try {
    const risposta = await invoke("anteprima", {
      percorso: file.percorso,
      posizione: posizione,
      forza: Number(scelte.forza),
      margine: Number(scelte.margine),
      display: sceltaDisplay(file),
      fisse: file.zoneFisse || [],
    });
    if (mioNumero !== numeroAnteprima) {
      return; // nel frattempo è stata chiesta un'altra anteprima
    }
    ultimaAnteprima = risposta;
    // l'ultima zona trovata dal programma: è il punto di partenza per le zone a mano
    if (risposta.zona && !risposta.fissa) {
      file.ultimaZona = risposta.zona;
    }
    $("anteprima-zona").classList.toggle("fissa", risposta.fissa);
    altreZone = risposta.altre || [];
    const img = $("anteprima-img");
    img.onload = () => {
      // mentre regoli la zona, la zona giusta è quella che stai spostando
      if (regolazioneAperta) {
        aggiornaZonaInModifica();
      } else {
        posizionaZona(img, $("anteprima-zona"), risposta.zona);
      }
      disegnaAltreZone();
      // la linea del Prima / Dopo va da sola sul display (finché non la sposti tu)
      if (!lineaSpostata) {
        centraLineaSullaZona(risposta.zona);
      }
    };
    img.src = risposta.immagine;
    $("risultato-img").src = risposta.risultato;
    mostraInfoAnteprima(risposta);

    if (risposta.zona) {
      $("anteprima-carico").classList.add("nascosto");
      $("testo-anteprima").textContent = file.foto
        ? "La zona tratteggiata è quella che verrà coperta. Doppio clic sulla zona per regolarla."
        : "La zona tratteggiata è quella che verrà coperta. Doppio clic sulla zona per regolarla.";
    } else {
      $("anteprima-carico").textContent = "Qui non trovo il display.";
      $("testo-anteprima").textContent = file.foto
        ? "In questa foto il numero non verrebbe coperto."
        : "Prova a spostare il cursore su un altro punto del video.";
    }
  } catch (errore) {
    if (mioNumero === numeroAnteprima) {
      $("anteprima-info").classList.add("nascosto");
      $("anteprima-carico").textContent = t("Anteprima non disponibile:") + " " + errore;
    }
  }
}

// ==========================================
// ANTEPRIMA: ORIGINALE / RISULTATO E SCHERMO INTERO
// ==========================================

// PRIMA / DOPO: dove sta la linea, da 0 a 1
// (0 = si vede tutto il risultato, 1 = si vede tutto l'originale)
let divisione = 0.5;
// true quando la linea l'hai spostata tu: allora non si sposta più da sola
let lineaSpostata = false;
// la linea si sta trascinando
let trascinaLinea = false;
// le altre zone coperte nell'anteprima: facce e oggetti seguiti
let altreZone = [];

// i riquadri tratteggiati blu per le facce e gli oggetti seguiti
function disegnaAltreZone() {
  const contenitore = $("anteprima-altre");
  contenitore.innerHTML = "";
  const img = $("anteprima-img");
  if (!img.naturalWidth) {
    return;
  }
  const g = geometriaImmagine(img);
  for (const z of altreZone) {
    const div = document.createElement("div");
    div.className = "zona-altra";
    div.style.left = g.sinistra + z.x * g.larghezza + "px";
    div.style.top = g.sopra + z.y * g.altezza + "px";
    div.style.width = z.w * g.larghezza + "px";
    div.style.height = z.h * g.altezza + "px";
    contenitore.appendChild(div);
  }
}
let schermoIntero = false;

// mette la linea e taglia l'immagine del risultato
function applicaDivisione() {
  divisione = Math.min(1, Math.max(0, divisione));
  const percentuale = divisione * 100;
  // il risultato si vede solo a destra della linea
  $("risultato-img").style.clipPath = "inset(0 0 0 " + percentuale + "%)";
  $("linea-confronto").style.left = percentuale + "%";
  // le scritte spariscono quando non c'è posto
  $("anteprima").classList.toggle("senza-prima", divisione < 0.12);
  $("anteprima").classList.toggle("senza-dopo", divisione > 0.88);
  $("linea-confronto").querySelector(".maniglia-confronto").setAttribute("aria-valuenow", Math.round(percentuale));
}

// la linea al centro della zona coperta, così taglia a metà il display
function centraLineaSullaZona(zona) {
  const img = $("anteprima-img");
  if (!zona || !img.naturalWidth || !img.clientWidth) {
    divisione = 0.5;
  } else {
    const g = geometriaImmagine(img);
    divisione = (g.sinistra + (zona.x + zona.w / 2) * g.larghezza) / img.clientWidth;
  }
  applicaDivisione();
}

// R o il menu: tutto originale oppure tutto risultato
function cambiaVista(nuova) {
  divisione = nuova === "risultato" ? 0 : 1;
  lineaSpostata = true;
  applicaDivisione();
}

function scambiaVista() {
  cambiaVista(divisione > 0.5 ? "risultato" : "originale");
}

// trascinare la linea con il mouse o il dito
function iniziaLinea(evento) {
  if (evento.button !== 0) {
    return;
  }
  trascinaLinea = true;
  $("linea-confronto").setPointerCapture(evento.pointerId);
  muoviLinea(evento);
}

function muoviLinea(evento) {
  if (!trascinaLinea) {
    return;
  }
  const r = $("anteprima").getBoundingClientRect();
  divisione = (evento.clientX - r.left) / r.width;
  lineaSpostata = true;
  applicaDivisione();
}

function fineLinea() {
  trascinaLinea = false;
}

// F o il bottone in alto a destra: l'anteprima riempie la finestra
function cambiaSchermoIntero() {
  schermoIntero = !schermoIntero;
  $("anteprima").classList.toggle("schermo-intero", schermoIntero);
  $("btn-schermo").querySelector("use").setAttribute("href", schermoIntero ? "#i-riduci" : "#i-schermo");
  $("btn-schermo").title = schermoIntero ? "Esci dallo schermo intero (Esc)" : "Schermo intero (F)";
}

// ==========================================
// PRESET: IMPOSTAZIONI SALVATE CON UN NOME
// ==========================================

// le scelte che un preset si ricorda
const SCELTE_PRESET = ["stile", "forza", "margine", "margineManuale", "volti", "momento", "colore", "coloreVideo", "posizione"];

function caricaPreset() {
  try {
    return JSON.parse(localStorage.getItem("preset") || "[]");
  } catch (e) {
    return [];
  }
}

function salvaPreset(lista) {
  try {
    localStorage.setItem("preset", JSON.stringify(lista));
  } catch (e) {
    // senza memoria i preset durano fino alla chiusura
  }
}

// true se le scelte di adesso sono uguali a quelle del preset
function presetUguale(preset) {
  return SCELTE_PRESET.every((nome) => JSON.stringify(preset.valori[nome]) === JSON.stringify(scelte[nome]));
}

function disegnaPreset() {
  const lista = $("lista-preset");
  lista.innerHTML = "";
  caricaPreset().forEach((preset, i) => {
    const chip = document.createElement("button");
    chip.className = "chip" + (presetUguale(preset) ? " attivo" : "");
    chip.title = "Usa queste impostazioni";
    chip.textContent = preset.nome;
    chip.addEventListener("click", () => usaPreset(preset));
    // la × per toglierlo
    const togli = document.createElement("span");
    togli.className = "togli-preset";
    togli.textContent = "×";
    togli.title = "Elimina";
    togli.addEventListener("click", (evento) => {
      evento.stopPropagation();
      eliminaPreset(i);
    });
    chip.appendChild(togli);
    lista.appendChild(chip);
  });
  const aggiungi = document.createElement("button");
  aggiungi.className = "chip aggiungi";
  aggiungi.textContent = "+ Salva";
  aggiungi.title = "Salva stile, forza, margine e display con un nome";
  aggiungi.addEventListener("click", nuovoPreset);
  lista.appendChild(aggiungi);
}

async function nuovoPreset() {
  const nome = await chiediNome("Salva preset", "Stile, forza, margine e impostazioni del display vengono salvati con questo nome.", "Salva", "");
  if (!nome) {
    return;
  }
  const valori = {};
  for (const n of SCELTE_PRESET) {
    valori[n] = scelte[n];
  }
  // con lo stesso nome si sostituisce quello vecchio
  const lista = caricaPreset().filter((p) => p.nome !== nome);
  lista.push({ nome: nome, valori: valori });
  salvaPreset(lista);
  disegnaPreset();
}

async function eliminaPreset(indice) {
  const lista = caricaPreset();
  const si = await chiedi(t("Eliminare «{nome}»?", { nome: lista[indice].nome }), "Le impostazioni di adesso non cambiano.", "Elimina", "Annulla");
  if (!si) {
    return;
  }
  lista.splice(indice, 1);
  salvaPreset(lista);
  disegnaPreset();
}

function usaPreset(preset) {
  const primaAnalisi = sceltePerAnalisi();
  Object.assign(scelte, preset.valori);
  salvaScelte();
  mettiScelteNeiControlli();
  // se cambia il modo di cercare il display, le strisce vanno rifatte
  if (sceltePerAnalisi() !== primaAnalisi) {
    for (const f of coda) {
      f.copertura = null;
    }
    analisiInCorso = "";
    analizzaSeServe();
    aggiornaSchedaFile();
  }
  caricaAnteprima();
}

// ==========================================
// FATTI DI RECENTE (schermata iniziale)
// ==========================================

const RECENTI_MASSIMI = 10;

function caricaRecenti() {
  try {
    return JSON.parse(localStorage.getItem("recenti") || "[]");
  } catch (e) {
    return [];
  }
}

function salvaRecenti(lista) {
  try {
    localStorage.setItem("recenti", JSON.stringify(lista.slice(0, RECENTI_MASSIMI)));
  } catch (e) {
    // memoria piena: pazienza, i recenti non sono importanti
  }
}

// rimpicciolisce un'immagine (per non riempire la memoria)
function immaginePiccola(src, larghezza) {
  return new Promise((fatto) => {
    if (!src) {
      fatto(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      const tela = document.createElement("canvas");
      const scala = larghezza / img.naturalWidth;
      // ritaglio orizzontale (16:9) verso il basso, dove c'è il cruscotto
      tela.width = larghezza;
      tela.height = Math.round(larghezza * 9 / 16);
      const altezzaPezzo = tela.height / scala;
      const sopra = Math.max(0, Math.min(img.naturalHeight - altezzaPezzo, img.naturalHeight * 0.62 - altezzaPezzo / 2));
      tela.getContext("2d").drawImage(img, 0, sopra, img.naturalWidth, altezzaPezzo, 0, 0, tela.width, tela.height);
      fatto(tela.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => fatto(null);
    img.src = src;
  });
}

async function salvaRecente(file, uscita) {
  const miniatura = await immaginePiccola(file.coppia ? file.coppia.dopo : null, 320);
  const lista = caricaRecenti().filter((r) => r.uscita !== uscita);
  lista.unshift({
    uscita: uscita,
    nome: file.nome.replace(/\.[^.]+$/, ""),
    data: Date.now(),
    durata: file.foto ? 0 : file.taglio ? file.taglio.fine - file.taglio.inizio : file.durata,
    foto: file.foto,
    miniatura: miniatura,
  });
  salvaRecenti(lista);
}

// "oggi", "ieri", "22 nov"
function testoData(ms) {
  const giorno = new Date(ms);
  const oggi = new Date();
  const inizioOggi = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate()).getTime();
  if (ms >= inizioOggi) {
    return t("oggi");
  }
  if (ms >= inizioOggi - 86400000) {
    return t("ieri");
  }
  return giorno.toLocaleDateString(lingua === "it" ? "it-CH" : lingua === "de" ? "de-CH" : "en-GB", { day: "numeric", month: "short" });
}

function disegnaRecenti() {
  const lista = caricaRecenti().slice(0, 5);
  $("recenti").classList.toggle("nascosto", !scelte.recenti || lista.length === 0);
  const contenitore = $("lista-recenti");
  contenitore.innerHTML = "";
  for (const r of lista) {
    const scheda = document.createElement("button");
    scheda.className = "scheda-recente";
    scheda.title = t("Apri");
    const figura = r.miniatura ? '<img alt="" src="' + r.miniatura + '">' : '<span class="senza-figura">' + icona(r.foto ? "foto" : "video") + "</span>";
    scheda.innerHTML = figura + '<span class="coperto"><i></i>' + t("Coperto") + '</span><span class="titolo"></span><span class="meta"></span>';
    scheda.querySelector(".titolo").textContent = r.nome;
    scheda.querySelector(".meta").textContent = testoData(r.data) + (r.durata ? " · " + formattaTempo(r.durata) : "");
    scheda.addEventListener("click", () => apriRecente(r));
    contenitore.appendChild(scheda);
  }
}

async function apriRecente(r) {
  try {
    await tauri.opener.openPath(r.uscita);
  } catch (e) {
    // il file non c'è più (spostato o cancellato): si toglie dall'elenco
    salvaRecenti(caricaRecenti().filter((x) => x.uscita !== r.uscita));
    disegnaRecenti();
  }
}

// ==========================================
// "COME FUNZIONA" (primo avvio)
// ==========================================

const PASSI_GUIDA = [
  {
    titolo: "Trascina i video della moto",
    testo: "Velocità trova il display in ogni fotogramma e copre il numero della velocità. I video restano sul tuo computer.",
    figura: '<img class="guida-icona" src="icona.png" alt="">',
  },
  {
    titolo: "La striscia ti dice dove guardare",
    testo: "Verde: coperto. Arancione e rosso: da controllare. Con le frecce vai a ogni tratto: «Va bene così» o «Copri a mano», e diventa verde.",
    figura: '<span class="guida-striscia"><i style="flex:12" class="v"></i><i style="flex:2" class="r"></i><i style="flex:20" class="v"></i><i style="flex:2" class="g"></i><i style="flex:14" class="v"></i></span>',
  },
  {
    titolo: "Avvia e il video è pronto",
    testo: "Il video coperto arriva accanto all'originale, con «_speed_blur» nel nome. Lo apri subito in DaVinci.",
    figura: '<span class="guida-file"><b>Lago Maggiore.mp4</b><b class="nuovo">Lago Maggiore_speed_blur.mp4</b></span>',
  },
];
let passoGuida = -1;

function mostraGuida() {
  passoGuida = 0;
  $("guida").classList.remove("nascosto");
  disegnaPassoGuida();
  $("guida-avanti").focus();
}

function disegnaPassoGuida() {
  const passo = PASSI_GUIDA[passoGuida];
  $("guida-numero").textContent = t("{n} di {totale}", { n: passoGuida + 1, totale: PASSI_GUIDA.length });
  $("guida-titolo").textContent = t(passo.titolo);
  $("guida-testo").textContent = t(passo.testo);
  $("guida-figura").innerHTML = passo.figura;
  $("guida-puntini").innerHTML = PASSI_GUIDA.map((_, i) => '<i class="' + (i === passoGuida ? "attivo" : "") + '"></i>').join("");
  $("guida-avanti").textContent = passoGuida === PASSI_GUIDA.length - 1 ? t("Inizia") : t("Avanti");
}

function avantiGuida() {
  if (passoGuida < PASSI_GUIDA.length - 1) {
    passoGuida++;
    disegnaPassoGuida();
  } else {
    chiudiGuida();
  }
}

function chiudiGuida() {
  passoGuida = -1;
  $("guida").classList.add("nascosto");
  scelte.guidaVista = true;
  salvaScelte();
}

// ==========================================
// TEMA: CHIARO, SCURO O COME IL MAC
// ==========================================

function applicaTema() {
  document.documentElement.dataset.tema = scelte.tema;
  aggiornaSegmentato("scelta-tema", scelte.tema);
  disegnaStriscia(); // la striscia usa i colori del tema
}

// ==========================================
// CARTELLA SORVEGLIATA
// ==========================================

// i file già provati (anche quelli andati male): non si riprovano
const giaProvati = new Set();

async function scegliSorvegliata() {
  const cartella = await tauri.dialog.open({ directory: true });
  if (cartella) {
    scelte.cartellaSorvegliata = cartella;
    salvaScelte();
    aggiornaSorvegliata();
  }
}

function togliSorvegliata() {
  scelte.cartellaSorvegliata = "";
  salvaScelte();
  aggiornaSorvegliata();
}

function aggiornaSorvegliata() {
  const c = scelte.cartellaSorvegliata;
  $("nome-sorvegliata").textContent = c ? nomeDaPercorso(c) : "Nessuna";
  $("nome-sorvegliata").title = c;
  $("btn-togli-sorvegliata").classList.toggle("nascosto", !c);
}

// ogni 10 secondi: ci sono video nuovi da coprire?
// Si parte da soli solo quando l'app è ferma sulla schermata iniziale o
// finale: se stai lavorando su una coda, si aspetta che tu abbia finito.
async function controllaSorvegliata() {
  if (!scelte.cartellaSorvegliata || alLavoro || rispostaDialogo || regolazioneAperta) {
    return;
  }
  if (!suSchermata("inizio") && !suSchermata("finito")) {
    return;
  }
  let nuovi;
  try {
    nuovi = await invoke("da_fare_in_cartella", { cartella: scelte.cartellaSorvegliata, uscita: scelte.cartella || null });
  } catch (e) {
    return; // cartella sparita o scollegata: si riprova dopo
  }
  nuovi = nuovi.filter((p) => !giaProvati.has(p));
  if (nuovi.length === 0 || alLavoro) {
    return;
  }
  for (const p of nuovi) {
    giaProvati.add(p);
  }
  if (nuovi.length === 1) {
    scriviRegistro(t("Cartella sorvegliata: 1 video nuovo"));
  } else {
    scriviRegistro(t("Cartella sorvegliata: {n} video nuovi", { n: nuovi.length }));
  }
  await aggiungiFile(nuovi);
  if (coda.length > 0 && suSchermata("pronto")) {
    avvia(true); // true = senza domande: lavora da solo
  }
}

// ==========================================
// BARRA SULL'ICONA (Dock del Mac, barra di Windows)
// ==========================================

let valoreDock = -1;

function barraDock(percentuale) {
  const valore = Math.round(percentuale);
  if (valore === valoreDock) {
    return; // uguale a prima: niente da fare
  }
  valoreDock = valore;
  try {
    tauri.window.getCurrentWindow().setProgressBar({ status: "normal", progress: valore }).catch(() => {});
  } catch (e) {
    // non importa
  }
}

function togliBarraDock() {
  if (valoreDock === -1) {
    return;
  }
  valoreDock = -1;
  try {
    tauri.window.getCurrentWindow().setProgressBar({ status: "none" }).catch(() => {});
  } catch (e) {
    // non importa
  }
}

// ==========================================
// 3. ELABORAZIONE
// ==========================================

let fileInCorso = 0;

// automatico = true: è partito da solo (cartella sorvegliata), senza domande
async function avvia(automatico) {
  if (alLavoro || coda.length === 0 || rispostaDialogo) {
    return;
  }
  // prima di partire: ci sono punti dove il numero resterebbe visibile?
  const conRossi = coda.filter((f) => !f.foto && f.copertura && f.copertura.finito && trattiNelTaglio(f, 0) > 0);
  if (conRossi.length > 0 && automatico !== true) {
    let testo;
    if (conRossi.length === 1) {
      const n = trattiNelTaglio(conRossi[0], 0);
      if (n === 1) {
        testo = t("In «{nome}» c'è 1 tratto rosso: lì il display non viene trovato e la velocità resterebbe visibile.", { nome: conRossi[0].nome });
      } else {
        testo = t("In «{nome}» ci sono {n} tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.", { nome: conRossi[0].nome, n: n });
      }
    } else {
      testo = t("In {n} video ci sono tratti rossi: lì il display non viene trovato e la velocità resterebbe visibile.", { n: conRossi.length });
    }
    testo += "\n\n" + t("Puoi controllarli e regolare la zona, oppure esportare lo stesso.");
    const controlla = await chiedi("Alcuni punti non sono coperti", testo, "Controlla", "Esporta lo stesso");
    if (controlla === null) {
      return; // Esc: non fa niente
    }
    if (controlla) {
      vaiAlProblema(conRossi[0]);
      return;
    }
  }
  alLavoro = true;
  inizioLavoro = Date.now();
  ultimiRisultati = [];
  $("registro").textContent = "";
  mostraSchermata("corso");

  const inizioTotale = Date.now();
  let interrotto = false;

  for (let i = 0; i < coda.length; i++) {
    fileInCorso = i;
    const file = coda[i];
    preparaSchermataCorso(file, i);
    scriviRegistro(t("Inizio:") + " " + file.nome);

    try {
      const risultato = await invoke("elabora", {
        percorso: file.percorso,
        cartella: scelte.cartella || null,
        usoCpu: valoreUsoCpu(),
        forza: Number(scelte.forza),
        margine: Number(scelte.margine),
        debug: $("interruttore-prova").checked,
        display: sceltaDisplay(file),
        taglio: file.taglio ? [file.taglio.inizio, file.taglio.fine] : null,
        fisse: file.zoneFisse || [],
      });

      if (risultato.interrotto) {
        scriviRegistro("Interrotto dall'utente.");
        interrotto = true;
        break;
      }
      // quanti tratti rossi c'erano (per dire «controlla» nel rapporto)
      const rossi = file.copertura && file.copertura.finito ? trattiNelTaglio(file, 0) : 0;
      salvaRecente(file, risultato.uscita);
      ultimiRisultati.push({ file: file, nome: file.nome, foto: file.foto, uscita: risultato.uscita, trovato: risultato.trovato, rossi: rossi, errore: null, secondi: risultato.secondi });
      scriviRegistro(t("Salvato:") + " " + risultato.uscita + " (" + formattaTempo(risultato.secondi) + ")");
      if (!risultato.trovato) {
        scriviRegistro(t("Attenzione: display mai trovato in {nome}", { nome: file.nome }));
      }
    } catch (errore) {
      ultimiRisultati.push({ file: file, nome: file.nome, foto: file.foto, uscita: null, trovato: false, rossi: 0, errore: String(errore) });
      scriviRegistro(t("Errore con {nome}:", { nome: file.nome }) + " " + errore);
    }
  }

  alLavoro = false;
  const secondiTotali = (Date.now() - inizioTotale) / 1000;

  if (interrotto) {
    mostraSchermata("pronto");
    caricaAnteprima();
    analizzaSeServe();
    return;
  }
  mostraFinito(secondiTotali);
  avvisaFine();
  analizzaSeServe(); // le analisi fermate durante il lavoro ripartono
}

// a destra, mentre lavora: fatto, in corso (con la percentuale) o in attesa
function disegnaCodaCorso(indiceCorrente) {
  const lista = $("lista-corso");
  lista.innerHTML = "";
  coda.forEach((file, i) => {
    let meta = file.foto ? "Foto" : formattaTempo(file.durata);
    let stato = '<span class="stato">In attesa</span>';
    if (i < indiceCorrente) {
      const r = ultimiRisultati[i];
      if (r && r.errore) {
        meta = "Non riuscito";
        stato = '<span class="segno errore">' + icona("x") + "</span>";
      } else if (r && !r.trovato) {
        meta = "Display non trovato";
        stato = '<span class="segno attenzione">' + icona("attenzione") + "</span>";
      } else {
        meta = r && r.secondi ? t("Fatto in {tempo}", { tempo: formattaTempo(r.secondi) }) : "Fatto";
        stato = '<span class="segno ok">' + icona("spunta") + "</span>";
      }
    } else if (i === indiceCorrente) {
      meta = "Avvio…";
      stato = '<span id="riga-percentuale" class="stato forte">0%</span>';
    }
    const riga = creaRigaFile("div", file, meta);
    if (i === indiceCorrente) {
      riga.classList.add("attivo");
      riga.querySelector(".meta").id = "riga-fotogrammi";
      riga.querySelector(".testi").insertAdjacentHTML("beforeend", '<div class="mini-barra"><div id="riga-barra"></div></div>');
    }
    riga.insertAdjacentHTML("beforeend", stato);
    lista.appendChild(riga);
  });
}

function preparaSchermataCorso(file, indice) {
  disegnaCodaCorso(indice);
  $("corso-nome").textContent = file.nome;
  $("corso-percentuale").textContent = "0%";
  aggiornaBarraPixel(0);
  $("corso-fotogrammi").textContent = "Avvio…";
  $("corso-mancano").textContent = "";
  $("corso-sottotitolo").textContent =
    coda.length > 1 ? t("File {n} di {totale}", { n: indice + 1, totale: coda.length }) : "Sto lavorando…";
  $("btn-interrompi").disabled = false;
  $("btn-interrompi").textContent = "Interrompi";

  // immagine del file in lavorazione (quella dell'anteprima, se è lo stesso)
  // si vede già coperto, come sarà il video finito
  const img = $("corso-img");
  $("corso-zona").classList.add("nascosto");
  if (indice === indiceAnteprima && ultimaAnteprima) {
    img.src = ultimaAnteprima.risultato;
    file.coppia = { prima: ultimaAnteprima.immagine, dopo: ultimaAnteprima.risultato, zona: ultimaAnteprima.zona };
  } else {
    img.removeAttribute("src"); // niente immagine del video di prima
    invoke("anteprima", {
      percorso: file.percorso,
      posizione: 0.3,
      forza: Number(scelte.forza),
      margine: Number(scelte.margine),
      display: sceltaDisplay(file),
      fisse: file.zoneFisse || [],
    })
      .then((r) => {
        file.coppia = { prima: r.immagine, dopo: r.risultato, zona: r.zona };
        if (fileInCorso === indice) {
          img.src = r.risultato;
        }
      })
      .catch(() => {});
  }
}

// la barra fatta di 24 quadratini: si riempiono man mano
const QUADRATINI = 24;

function aggiornaBarraPixel(percentuale) {
  const barra = $("barra-pixel");
  if (barra.children.length !== QUADRATINI) {
    barra.innerHTML = "";
    for (let i = 0; i < QUADRATINI; i++) {
      barra.appendChild(document.createElement("i"));
    }
  }
  const pieni = (percentuale / 100) * QUADRATINI;
  [...barra.children].forEach((q, i) => {
    q.classList.toggle("pieno", i < Math.floor(pieni));
    // quello che si sta riempiendo è a metà
    q.classList.toggle("mezzo", i === Math.floor(pieni) && pieni < QUADRATINI);
  });
}

// arriva da Rust mentre lavora
tauri.event.listen("avanzamento", (evento) => {
  const a = evento.payload;
  const percentuale = a.totali > 0 ? Math.min(100, Math.floor((a.fatti / a.totali) * 100)) : 0;
  aggiornaBarraPixel(percentuale);
  $("corso-percentuale").textContent = percentuale + "%";
  // sull'icona: quanto manca a tutta la coda, non solo a questo file
  if (a.totali > 0 && coda.length > 0) {
    barraDock(((fileInCorso + a.fatti / a.totali) / coda.length) * 100);
  }
  $("corso-fotogrammi").textContent = t("Fotogramma {n} di {totale}", { n: formattaNumero(a.fatti), totale: formattaNumero(a.totali) });
  // la riga del file in corso, a destra
  if ($("riga-percentuale")) {
    $("riga-percentuale").textContent = percentuale + "%";
    $("riga-barra").style.width = percentuale + "%";
    $("riga-fotogrammi").textContent = t("{n} di {totale} fotogrammi", { n: formattaNumero(a.fatti), totale: formattaNumero(a.totali) });
  }
  if (a.fatti > 30 && a.fatti < a.totali) {
    $("corso-mancano").textContent = t("Mancano circa {tempo}", { tempo: formattaTempo(a.secondi_mancanti) });
  } else if (a.fatti >= a.totali) {
    $("corso-mancano").textContent = "Salvo il video…";
  }
});

async function interrompi() {
  if (!alLavoro || $("btn-interrompi").disabled) {
    return;
  }
  // dopo un minuto di lavoro si chiede prima di buttarlo via
  if (Date.now() - inizioLavoro > 60000) {
    const si = await chiedi("Interrompere?", "Il video in corso non verrà salvato. I file già finiti restano.", "Interrompi", "Continua");
    if (!si || !alLavoro) {
      return;
    }
  }
  $("btn-interrompi").disabled = true;
  $("btn-interrompi").textContent = "Interruzione…";
  await invoke("interrompi");
}

// ==========================================
// 4. SCHERMATA FINITA
// ==========================================

function mostraFinito(secondi) {
  const riusciti = ultimiRisultati.filter((r) => r.uscita);
  const sbagliati = ultimiRisultati.filter((r) => r.errore);
  const nonTrovati = riusciti.filter((r) => !r.trovato);
  const conRossi = riusciti.filter((r) => r.trovato && r.rossi > 0);
  const iconaEsito = $("esito-icona");
  // il testo completo degli errori, per «Copia dettagli»
  dettagliErrore = sbagliati.map((r) => r.nome + ": " + r.errore).join("\n");
  $("btn-copia").classList.toggle("nascosto", sbagliati.length === 0);
  $("btn-torna").classList.remove("nascosto");

  if (riusciti.length === 0) {
    iconaEsito.className = "esito-icona errore";
    iconaEsito.innerHTML = icona("attenzione");
    $("esito-titolo").textContent = "Non è andata";
    $("esito-testo").textContent = sbagliati.length > 0 ? erroreSemplice(sbagliati[0].errore) : "Nessun file è stato creato.";
  } else if (nonTrovati.length > 0 || sbagliati.length > 0 || conRossi.length > 0) {
    iconaEsito.className = "esito-icona attenzione";
    iconaEsito.innerHTML = icona("attenzione");
    $("esito-titolo").textContent = "Fatto, ma controlla";
    const pezzi = [];
    if (nonTrovati.length > 0) {
      pezzi.push(t("In {nomi} non ho trovato il display.", { nomi: nonTrovati.map((r) => r.nome).join(", ") }));
    }
    if (conRossi.length > 0) {
      pezzi.push(t("In {nomi} alcuni tratti non sono coperti.", { nomi: conRossi.map((r) => r.nome).join(", ") }));
    }
    if (sbagliati.length > 0) {
      if (sbagliati.length === 1) {
        pezzi.push(t("1 file non è stato elaborato (il motivo è qui sotto)."));
      } else {
        pezzi.push(t("{n} file non sono stati elaborati (il motivo è qui sotto).", { n: sbagliati.length }));
      }
    }
    pezzi.push(t("Con «Correggi» torni al video e lo sistemi."));
    $("esito-testo").textContent = pezzi.join(" ");
  } else {
    iconaEsito.className = "esito-icona ok pixel";
    // la spunta fatta di quadratini (si compone una volta, piano piano)
    iconaEsito.innerHTML = '<span class="spunta-pixel"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>';
    $("esito-titolo").textContent = "Fatto";
    if (riusciti.length === 1) {
      const nome = nomeDaPercorso(riusciti[0].uscita);
      $("esito-testo").textContent = scelte.cartella
        ? t("{nome} è nella cartella scelta.", { nome: nome })
        : t("{nome} è accanto all'originale.", { nome: nome });
    } else {
      $("esito-testo").textContent = t("{n} file pronti.", { n: riusciti.length });
    }
  }
  $("esito-tempo").textContent = t("Tempo impiegato: {tempo}", { tempo: formattaTempo(secondi) });

  $("btn-apri").classList.toggle("nascosto", riusciti.length !== 1);
  $("btn-mostra").classList.toggle("nascosto", riusciti.length === 0);
  disegnaRisultati();
  // se non è riuscito niente, l'immagine non serve (potrebbe confondere)
  // il prima / dopo dell'ultimo video riuscito (se non è riuscito niente, nessuna immagine)
  const ultimo = riusciti.length > 0 ? riusciti[riusciti.length - 1].file : null;
  mostraImmagineFinito(ultimo && ultimo.coppia ? ultimo.coppia : null);
  mostraSchermata("finito");
}

// elenco a destra: un file per riga, con un clic si apre
// elenco a destra: un file per riga, con «Apri» e, se serve, «Correggi»
function disegnaRisultati() {
  const lista = $("lista-risultati");
  lista.innerHTML = "";
  const conProblemi = ultimiRisultati.some((r) => r.errore || !r.trovato || r.rossi > 0);
  if (ultimiRisultati.length < 2 && !conProblemi) {
    return; // con un solo file andato bene basta il testo sopra
  }
  for (const r of ultimiRisultati) {
    let meta = "Coperto";
    let stato = '<span class="segno ok" title="Coperto">' + icona("spunta") + "</span>";
    let correggi = false;
    if (r.errore) {
      meta = erroreSemplice(r.errore);
      stato = '<span class="segno errore" title="Non riuscito">' + icona("x") + "</span>";
    } else if (!r.trovato) {
      meta = "Display non trovato: controlla";
      stato = '<span class="segno attenzione" title="Da controllare">' + icona("attenzione") + "</span>";
      correggi = true;
    } else if (r.rossi > 0) {
      meta = r.rossi === 1 ? t("1 tratto non coperto") : t("{n} tratti non coperti", { n: r.rossi });
      stato = '<span class="segno attenzione" title="Da controllare">' + icona("attenzione") + "</span>";
      correggi = true;
    }
    const nome = r.uscita ? nomeDaPercorso(r.uscita) : r.nome;
    const riga = creaRigaFile("div", { nome: nome, foto: r.foto, miniature: r.file ? r.file.miniature : null }, meta);
    riga.title = r.errore || "";

    // i bottoni della riga, scritti per bene (non solo nascosti nel clic)
    const azioni = document.createElement("span");
    azioni.className = "azioni-riga";
    if (correggi && coda.includes(r.file)) {
      const bottone = document.createElement("button");
      bottone.className = "link";
      bottone.textContent = "Correggi";
      bottone.addEventListener("click", () => correggiFile(r.file));
      azioni.appendChild(bottone);
    }
    if (r.uscita) {
      const bottone = document.createElement("button");
      bottone.className = "link";
      bottone.textContent = "Apri";
      bottone.addEventListener("click", () => tauri.opener.openPath(r.uscita));
      azioni.appendChild(bottone);
    }
    riga.appendChild(azioni);
    riga.insertAdjacentHTML("beforeend", stato);
    lista.appendChild(riga);
  }
}

// «Correggi»: torna al video, sul primo punto che non va
function correggiFile(file) {
  vaiAlProblema(file);
}

// «Torna ai video»: la coda resta com'era
function tornaAiVideo() {
  if (coda.length === 0) {
    mostraSchermata("inizio");
    return;
  }
  indiceAnteprima = Math.min(indiceAnteprima, coda.length - 1);
  aggiornaSchedaFile();
  mostraSchermata("pronto");
  caricaAnteprima();
  analizzaSeServe();
}

// a sinistra nella schermata finale: l'ultimo fotogramma visto
// a sinistra della schermata finale: prima / dopo (coppia = { prima, dopo })
function mostraImmagineFinito(coppia) {
  const c = coppia || null;
  $("finito-prima").classList.toggle("nascosto", !c);
  $("finito-img").classList.toggle("nascosto", !c);
  $("finito-linea").classList.toggle("nascosto", !c);
  if (c) {
    const prima = $("finito-prima");
    // la linea va sul display, così si vede bene la differenza
    prima.onload = () => {
      divisioneFinito = 0.5;
      if (c.zona && prima.clientWidth) {
        const g = geometriaImmagine(prima);
        divisioneFinito = (g.sinistra + (c.zona.x + c.zona.w / 2) * g.larghezza) / prima.clientWidth;
      }
      applicaDivisioneFinito();
    };
    prima.src = c.prima;
    $("finito-img").src = c.dopo;
    divisioneFinito = 0.5;
    applicaDivisioneFinito();
  }
}

// la linea del prima / dopo nella schermata finale
let divisioneFinito = 0.5;
let trascinaFinito = false;

function applicaDivisioneFinito() {
  divisioneFinito = Math.min(1, Math.max(0, divisioneFinito));
  $("finito-img").style.clipPath = "inset(0 0 0 " + divisioneFinito * 100 + "%)";
  $("finito-linea").style.left = divisioneFinito * 100 + "%";
  $("finito-anteprima").classList.toggle("senza-prima", divisioneFinito < 0.12);
  $("finito-anteprima").classList.toggle("senza-dopo", divisioneFinito > 0.88);
}

function muoviLineaFinito(evento) {
  if (!trascinaFinito) {
    return;
  }
  const r = $("finito-anteprima").getBoundingClientRect();
  divisioneFinito = (evento.clientX - r.left) / r.width;
  applicaDivisioneFinito();
}

async function apriRisultato() {
  const r = ultimiRisultati.find((x) => x.uscita);
  if (r) {
    await tauri.opener.openPath(r.uscita);
  }
}

async function mostraNellaCartella() {
  const r = ultimiRisultati.find((x) => x.uscita);
  if (r) {
    await tauri.opener.revealItemInDir(r.uscita);
  }
}

// notifica di sistema se la finestra non è in primo piano
async function avvisaFine() {
  try {
    const inPrimoPiano = await tauri.window.getCurrentWindow().isFocused();
    if (inPrimoPiano) {
      return;
    }
    let permesso = await tauri.notification.isPermissionGranted();
    if (!permesso) {
      permesso = (await tauri.notification.requestPermission()) === "granted";
    }
    if (permesso) {
      tauri.notification.sendNotification({
        title: "Velocità",
        body: $("esito-titolo").textContent + ". " + $("esito-testo").textContent,
      });
    }
  } catch (e) {
    // la notifica non è indispensabile
  }
}

function mostraErrore(titolo, testo, dettagli) {
  ultimiRisultati = [];
  dettagliErrore = dettagli || "";
  $("btn-copia").classList.toggle("nascosto", !dettagli);
  $("btn-torna").classList.toggle("nascosto", coda.length === 0);
  const iconaEsito = $("esito-icona");
  iconaEsito.className = "esito-icona errore";
  iconaEsito.innerHTML = icona("attenzione");
  $("esito-titolo").textContent = titolo;
  $("esito-testo").textContent = testo;
  $("esito-tempo").textContent = "";
  $("btn-apri").classList.add("nascosto");
  $("btn-mostra").classList.add("nascosto");
  disegnaRisultati();
  // l'immagine di un altro video confonderebbe: qui non se ne mostra nessuna
  mostraImmagineFinito(null);
  mostraSchermata("finito");
}

// ==========================================
// AGGIORNAMENTI AUTOMATICI (da GitHub)
// ==========================================

async function controllaAggiornamenti(manuale) {
  if (manuale) {
    $("btn-controlla").textContent = "Controllo…";
  }
  try {
    aggiornamento = await tauri.updater.check();
    if (aggiornamento) {
      $("avviso-titolo").textContent = t("È disponibile la versione {versione}", { versione: aggiornamento.version });
      // prima riga delle note della release
      const note = (aggiornamento.body || "").split("\n").find((r) => r.trim() !== "") || "";
      $("avviso-note").textContent = note.replace(/^[#*\-\s]+/, "");
      $("avviso").classList.remove("nascosto");
      if (manuale) {
        $("btn-controlla").textContent = t("Disponibile la {versione}", { versione: aggiornamento.version });
        mostraSchermata(coda.length > 0 ? "pronto" : "inizio");
      }
    } else if (manuale) {
      $("btn-controlla").textContent = "Hai l'ultima versione";
    }
  } catch (errore) {
    if (manuale) {
      $("btn-controlla").textContent = "Controllo non riuscito";
      console.log(errore);
    }
  }
}

async function installaAggiornamento() {
  if (!aggiornamento || alLavoro) {
    return;
  }
  const bottone = $("btn-aggiorna");
  bottone.disabled = true;
  $("btn-dopo").classList.add("nascosto");

  let scaricati = 0;
  let totale = 0;
  try {
    await aggiornamento.downloadAndInstall((evento) => {
      if (evento.event === "Started") {
        totale = evento.data.contentLength || 0;
      } else if (evento.event === "Progress") {
        scaricati += evento.data.chunkLength;
        if (totale > 0) {
          bottone.textContent = Math.floor((scaricati / totale) * 100) + "%";
        }
      } else if (evento.event === "Finished") {
        bottone.textContent = "Riavvio…";
      }
    });
    await tauri.process.relaunch();
  } catch (errore) {
    bottone.disabled = false;
    bottone.textContent = "Riprova";
    $("avviso-note").textContent = t("Aggiornamento non riuscito:") + " " + errore;
  }
}

// ==========================================
// IMPOSTAZIONI
// ==========================================

let schermataPrimaImpostazioni = "inizio";
// le scelte del display quando si aprono le impostazioni (per vedere se cambiano)
let displayPrimaImpostazioni = "";

// le scelte che cambiano il risultato dell'analisi, scritte come testo
function sceltePerAnalisi() {
  return JSON.stringify([scelte.momento, scelte.colore, scelte.coloreVideo, scelte.posizione]);
}

function apriImpostazioni() {
  if (alLavoro || regolazioneAperta || !$("schermata-impostazioni").classList.contains("nascosto") || !$("schermata-scegli").classList.contains("nascosto")) {
    return;
  }
  for (const s of ["inizio", "pronto", "finito"]) {
    if (!$("schermata-" + s).classList.contains("nascosto")) {
      schermataPrimaImpostazioni = s;
    }
  }
  $("btn-controlla").textContent = "Controlla ora";
  displayPrimaImpostazioni = sceltePerAnalisi();
  mostraSchermata("impostazioni");
}

// menu a sinistra delle impostazioni: mostra una sezione alla volta
function mostraSezioneImpostazioni(nome) {
  for (const b of $("menu-impostazioni").querySelectorAll("button")) {
    b.classList.toggle("attivo", b.dataset.sezione === nome);
    $("sezione-" + b.dataset.sezione).classList.toggle("nascosto", b.dataset.sezione !== nome);
  }
}

function chiudiImpostazioni() {
  mostraSchermata(schermataPrimaImpostazioni);
  if (sceltePerAnalisi() !== displayPrimaImpostazioni) {
    // il display si cerca in un altro modo: le strisce vecchie non valgono più
    for (const f of coda) {
      f.copertura = null;
    }
    analisiInCorso = "";
  }
  if (schermataPrimaImpostazioni === "pronto") {
    analizzaSeServe();
    caricaAnteprima(); // forza e margine potrebbero essere cambiati
  }
}

// ==========================================
// STRISCIA COLORATA (analisi veloce del video)
// ==========================================

// colore di ogni stato: 0 non trovato, 1 da controllare, 2 coperto
// 3 = coperto con una zona disegnata a mano: è verde anche lui (è a posto)
const COLORI_STRISCIA = ["--rosso", "--ambra", "--verde", "--verde"];
// il video che si sta analizzando adesso ("" = nessuno)
let analisiInCorso = "";

// true se il video non è ancora stato analizzato fino in fondo
function daAnalizzare(file) {
  return file && !file.foto && !(file.copertura && file.copertura.finito);
}

// analizza i video della coda uno alla volta:
// prima quello mostrato nell'anteprima, poi gli altri in ordine
function analizzaSeServe() {
  if (alLavoro) {
    return; // mentre esporta, il computer serve per quello
  }
  let file = coda[indiceAnteprima];
  if (!daAnalizzare(file)) {
    file = coda.find(daAnalizzare);
  }
  if (!file || analisiInCorso === file.percorso) {
    return;
  }
  // un altro video è già in analisi: si aspetta che finisca
  // (solo il video mostrato può passare avanti)
  if (analisiInCorso !== "" && file !== coda[indiceAnteprima]) {
    return;
  }
  analisiInCorso = file.percorso;
  file.copertura = { stati: [], totali: 1, finito: false };
  disegnaStriscia();
  disegnaCodaSeFerma();
  invoke("analizza", { percorso: file.percorso, display: sceltaDisplay(file) })
    .catch((errore) => {
      file.copertura = { stati: [], totali: 1, finito: true, errore: String(errore) };
      disegnaStriscia();
    })
    .finally(() => {
      if (analisiInCorso === file.percorso) {
        analisiInCorso = "";
        disegnaCodaSeFerma();
        analizzaSeServe(); // passa al prossimo video della coda
      }
    });
}

// ridisegna la lista (ma non mentre si sta trascinando una riga)
function disegnaCodaSeFerma() {
  if (!rigaTrascinata && suSchermata("pronto")) {
    disegnaCoda();
  }
}

// arriva da Rust mentre analizza
tauri.event.listen("copertura", (evento) => {
  const c = evento.payload;
  const file = coda.find((f) => f.percorso === c.percorso);
  if (!file) {
    return;
  }
  file.copertura = { stati: c.stati, totali: c.totali, finito: c.finito };
  if (file === coda[indiceAnteprima]) {
    disegnaStriscia();
  }
  if (c.finito) {
    disegnaCodaSeFerma(); // il pallino della lista diventa verde, arancione o rosso
  }
});

// il valore di un colore del CSS, es. "--verde" -> "#2e8b57"
function coloreCss(nome) {
  return getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
}

// quanti tratti di fila hanno questo stato (es. 2 tratti rossi)
function contaTratti(stati, stato) {
  let tratti = 0;
  for (let i = 0; i < stati.length; i++) {
    if (stati[i] === stato && (i === 0 || stati[i - 1] !== stato)) {
      tratti++;
    }
  }
  return tratti;
}

// il punto i della striscia è dentro il pezzo da salvare?
function dentroTaglio(file, i) {
  if (!file.taglio) {
    return true;
  }
  const c = file.copertura;
  const secondi = (i / Math.max(c.totali, c.stati.length)) * file.durata;
  return secondi >= file.taglio.inizio && secondi <= file.taglio.fine;
}

// la zona a mano che vale in quel secondo (null = nessuna).
// Come nel motore: se due si sovrappongono vince l'ultima aggiunta.
function zonaFissaA(file, secondi) {
  const zone = file.zoneFisse || [];
  for (let i = zone.length - 1; i >= 0; i--) {
    if (!zone[i].segui && secondi >= zone[i].inizio && secondi <= zone[i].fine) {
      return zone[i];
    }
  }
  return null;
}

// gli stati della striscia, con le zone a mano: dove c'è una zona
// disegnata a mano il punto diventa 3 (coperto a mano)
function statiEffettivi(file) {
  const c = file.copertura;
  if (!c) {
    return [];
  }
  const totale = Math.max(c.totali, c.stati.length);
  return c.stati.map((stato, i) => {
    const meta = ((i + 0.5) / totale) * file.durata; // il secondo a metà del punto
    if (zonaFissaA(file, meta)) {
      return 3; // coperto con una zona a mano
    }
    if (stato < 2 && confermato(file, meta)) {
      return 2; // hai detto «Va bene così»: è verde
    }
    return stato;
  });
}

// true se in quel secondo hai detto «Va bene così»
function confermato(file, secondi) {
  return (file.confermati || []).some((c) => secondi >= c.inizio && secondi <= c.fine);
}

// come contaTratti, ma conta solo quelli dentro il pezzo da salvare
function trattiNelTaglio(file, stato) {
  const c = file.copertura;
  if (!c) {
    return 0;
  }
  const stati = statiEffettivi(file);
  let tratti = 0;
  let primaDentro = false;
  for (let i = 0; i < stati.length; i++) {
    const dentro = stati[i] === stato && dentroTaglio(file, i);
    if (dentro && !primaDentro) {
      tratti++;
    }
    primaDentro = dentro;
  }
  return tratti;
}

// dove inizia ogni tratto rosso o arancione (da 0 a 1, a metà del primo punto)
function iniziTratti(file, soloStato) {
  const c = file.copertura;
  const lista = [];
  if (!c) {
    return lista;
  }
  const totale = Math.max(c.totali, c.stati.length);
  const stati = statiEffettivi(file);
  for (let i = 0; i < stati.length; i++) {
    const stato = stati[i];
    const problema = soloStato === undefined ? stato < 2 : stato === soloStato;
    if (problema && (i === 0 || stati[i - 1] !== stato) && dentroTaglio(file, i)) {
      lista.push((i + 0.5) / totale);
    }
  }
  return lista;
}

// porta l'anteprima in un punto del video (da 0 a 1)
function vaiAlPunto(posizione) {
  $("cursore-anteprima").value = Math.round(Math.min(1, Math.max(0, posizione)) * 1000);
  aggiornaTempoCursore();
  clearTimeout(timerAnteprima);
  timerAnteprima = setTimeout(caricaAnteprima, 120);
}

// frecce sulla striscia: salta al prossimo (o al precedente) punto da controllare
function saltaAlTratto(avanti) {
  const file = coda[indiceAnteprima];
  if (!file || file.foto || !file.copertura) {
    return;
  }
  const ora = Number($("cursore-anteprima").value) / 1000;
  const lista = iniziTratti(file);
  let scelto;
  if (avanti) {
    scelto = lista.find((p) => p > ora + 0.002);
  } else {
    scelto = lista.reverse().find((p) => p < ora - 0.002);
  }
  if (scelto === undefined) {
    $("testo-anteprima").textContent = lista.length === 0
      ? "Non ci sono punti da controllare."
      : avanti ? "Non ci sono altri punti da controllare più avanti." : "Non ci sono punti da controllare prima di questo.";
    return;
  }
  vaiAlPunto(scelto);
}

// apre il video nell'anteprima, sul primo tratto rosso (o arancione)
function vaiAlProblema(file) {
  const indice = coda.indexOf(file);
  if (indice < 0) {
    return;
  }
  indiceAnteprima = indice;
  mostraSchermata("pronto");
  aggiornaSchedaFile();
  const rossi = iniziTratti(file, 0);
  const arancioni = iniziTratti(file, 1);
  if (rossi.length > 0) {
    $("cursore-anteprima").value = Math.round(rossi[0] * 1000);
  } else if (arancioni.length > 0) {
    $("cursore-anteprima").value = Math.round(arancioni[0] * 1000);
  }
  aggiornaTempoCursore();
  caricaAnteprima();
  analizzaSeServe();
  $("striscia").focus();
}

// "1 tratto", "3 tratti"
function testoTratti(numero) {
  return numero === 1 ? t("1 tratto") : t("{n} tratti", { n: numero });
}

function disegnaStriscia() {
  const file = coda[indiceAnteprima];
  const nascondi = !file || file.foto;
  $("striscia").classList.toggle("nascosto", nascondi);
  $("legenda").classList.toggle("nascosto", nascondi);
  if (nascondi) {
    return;
  }

  // la tela va disegnata alla risoluzione dello schermo (Retina)
  const tela = $("striscia-tela");
  const larghezza = tela.clientWidth;
  const altezza = tela.clientHeight;
  const densita = window.devicePixelRatio || 1;
  tela.width = Math.round(larghezza * densita);
  tela.height = Math.round(altezza * densita);
  const ctx = tela.getContext("2d");
  ctx.scale(densita, densita);

  // sfondo grigio: la parte non ancora analizzata
  ctx.fillStyle = coloreCss("--controllo-sopra");
  ctx.fillRect(0, 0, larghezza, altezza);

  const c = file.copertura;
  if (!c) {
    aggiornaSegniTaglio(file);
    $("legenda").innerHTML = "";
    return;
  }
  const passo = larghezza / Math.max(c.totali, c.stati.length);
  const stati = statiEffettivi(file);
  stati.forEach((stato, i) => {
    ctx.fillStyle = coloreCss(COLORI_STRISCIA[stato]);
    ctx.fillRect(i * passo, 0, passo + 0.5, altezza);
  });
  // non solo colori (per chi non distingue bene rosso, arancione e verde):
  // arancione = righe oblique, rosso = a trattini
  disegnaMotivi(ctx, stati, passo, altezza);
  // con un taglio, la parte che non viene salvata è più chiara
  if (file.taglio && file.durata > 0) {
    ctx.fillStyle = coloreCss("--sfondo");
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, 0, (file.taglio.inizio / file.durata) * larghezza, altezza);
    const fine = (file.taglio.fine / file.durata) * larghezza;
    ctx.fillRect(fine, 0, larghezza - fine, altezza);
    ctx.globalAlpha = 1;
  }

  aggiornaSegniTaglio(file);

  // la scritta sotto
  const legenda = $("legenda");
  if (c.errore) {
    legenda.textContent = t("Analisi non riuscita:") + " " + c.errore;
    return;
  }
  if (!c.finito) {
    const percentuale = Math.floor((c.stati.length / Math.max(1, c.totali)) * 100);
    legenda.textContent = t("Analisi del video… {n}%", { n: percentuale });
    return;
  }
  // si contano solo i tratti dentro il pezzo da salvare
  const incerti = trattiNelTaglio(file, 1);
  const mancanti = trattiNelTaglio(file, 0);
  const pezzi = [];
  if (incerti === 0 && mancanti === 0) {
    pezzi.push('<span><i style="background:var(--verde)"></i><b class="simbolo">✓</b>Display trovato in tutto il video</span>');
  } else {
    pezzi.push('<span><i style="background:var(--verde)"></i><b class="simbolo">✓</b>Coperto</span>');
    if (incerti > 0) {
      pezzi.push('<span><i class="ambra"></i><b class="simbolo">!</b>' + t("Da controllare") + " · " + testoTratti(incerti) + "</span>");
    }
    if (mancanti > 0) {
      pezzi.push('<span><i class="rosso"></i><b class="simbolo">✕</b>' + t("Non trovato") + " · " + testoTratti(mancanti) + "</span>");
    }
  }
  const seguiti = (file.zoneFisse || []).filter((z) => z.segui).length;
  if (seguiti > 0) {
    pezzi.push('<span><b class="simbolo">↝</b>' + t("Segue") + " · " + (seguiti === 1 ? t("1 oggetto") : t("{n} oggetti", { n: seguiti })) + "</span>");
  }
  legenda.innerHTML = pezzi.join("");
  aggiornaBarraProblemi();
}

// ==========================================
// TRATTI DA CONTROLLARE (barra sotto la striscia)
// ==========================================

// i tratti rossi e arancioni ancora da sistemare, dentro il pezzo da salvare:
// [{ inizio, fine, stato }] in secondi
function elencoProblemi(file) {
  const c = file && file.copertura;
  if (!c || !c.finito || file.foto) {
    return [];
  }
  const stati = statiEffettivi(file);
  const totale = Math.max(c.totali, c.stati.length);
  const lista = [];
  for (let i = 0; i < stati.length; i++) {
    if (stati[i] >= 2 || !dentroTaglio(file, i)) {
      continue;
    }
    const inizio = (i / totale) * file.durata;
    const fine = ((i + 1) / totale) * file.durata;
    const ultimo = lista[lista.length - 1];
    // stesso colore e attaccato al precedente: è lo stesso tratto
    if (ultimo && ultimo.stato === stati[i] && Math.abs(ultimo.fine - inizio) < 0.01) {
      ultimo.fine = fine;
    } else {
      lista.push({ inizio: inizio, fine: fine, stato: stati[i] });
    }
  }
  return lista;
}

// il tratto dove sta il cursore adesso (null = nessuno)
function problemaAttuale(file, lista) {
  const ora = secondiCursore(file);
  return lista.find((p) => ora >= p.inizio - 0.3 && ora <= p.fine + 0.3) || null;
}

function aggiornaBarraProblemi() {
  const file = coda[indiceAnteprima];
  const barra = $("barra-problemi");
  if (!file || file.foto || !file.copertura || !file.copertura.finito || regolazioneAperta) {
    barra.classList.add("nascosto");
    return;
  }
  const lista = elencoProblemi(file);
  barra.classList.remove("nascosto");
  barra.classList.toggle("tutto-verde", lista.length === 0);
  if (lista.length === 0) {
    $("problemi-testo").textContent = t("Tutto verde: non c'è niente da controllare.");
    return;
  }
  const attuale = problemaAttuale(file, lista);
  $("problemi-testo").textContent = lista.length === 1 ? t("1 tratto da controllare") : t("{n} tratti da controllare", { n: lista.length });
  $("problemi-numero").textContent = attuale ? t("{n} di {totale}", { n: lista.indexOf(attuale) + 1, totale: lista.length }) : "–";
  barra.classList.toggle("su-un-tratto", Boolean(attuale));
  barra.classList.toggle("rosso", Boolean(attuale && attuale.stato === 0));
  $("btn-va-bene").disabled = !attuale;
  $("btn-copri-tratto").disabled = !attuale;
}

// ‹ ›: al tratto prima o dopo (dall'ultimo si ricomincia dal primo)
function vaiAlProblemaVicino(avanti) {
  const file = coda[indiceAnteprima];
  const lista = elencoProblemi(file);
  if (lista.length === 0) {
    aggiornaBarraProblemi();
    return;
  }
  const ora = secondiCursore(file);
  const attuale = problemaAttuale(file, lista);
  let scelto;
  if (avanti) {
    scelto = lista.find((p) => p.inizio > (attuale ? attuale.fine : ora)) || lista[0];
  } else {
    const prima = lista.filter((p) => p.fine < (attuale ? attuale.inizio : ora));
    scelto = prima[prima.length - 1] || lista[lista.length - 1];
  }
  // il cursore va a metà del tratto, così vedi bene il punto
  vaiAlPunto((scelto.inizio + scelto.fine) / 2 / file.durata);
  aggiornaBarraProblemi();
}

// «Va bene così»: qui il numero non si vede comunque, il tratto diventa verde
function vaBeneCosi() {
  const file = coda[indiceAnteprima];
  const attuale = problemaAttuale(file, elencoProblemi(file));
  if (!attuale) {
    return;
  }
  file.confermati = file.confermati || [];
  file.confermati.push({ inizio: attuale.inizio, fine: attuale.fine });
  dopoUnTrattoSistemato();
}

// dopo «Va bene così»: tutto si aggiorna e si va al prossimo tratto
function dopoUnTrattoSistemato() {
  disegnaStriscia();
  disegnaZoneFisse();
  disegnaCodaSeFerma();
  const file = coda[indiceAnteprima];
  if (elencoProblemi(file).length > 0) {
    vaiAlProblemaVicino(true);
  } else {
    aggiornaBarraProblemi();
  }
}

// «Annulla» nel pannello: i tratti «Va bene così» tornano come prima
function annullaConfermati() {
  const file = coda[indiceAnteprima];
  file.confermati = [];
  disegnaStriscia();
  disegnaZoneFisse();
  disegnaCodaSeFerma();
}


// righe oblique sui tratti arancioni, trattini sui tratti rossi
function disegnaMotivi(ctx, stati, passo, altezza) {
  ctx.save();
  stati.forEach((stato, i) => {
    if (stato >= 2) {
      return; // verde e blu: niente disegno
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(i * passo, 0, passo + 0.5, altezza);
    ctx.clip();
    if (stato === 1) {
      // righe chiare oblique, una ogni 4 pixel (sempre allineate, anche tra un punto e l'altro)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 1;
      const inizio = Math.floor((i * passo) / 4) * 4 - altezza;
      for (let x = inizio; x < (i + 1) * passo + altezza; x += 4) {
        ctx.beginPath();
        ctx.moveTo(x, altezza);
        ctx.lineTo(x + altezza, 0);
        ctx.stroke();
      }
    } else {
      // buchi di 1 pixel ogni 4: sembra una linea a trattini
      ctx.fillStyle = coloreCss("--sfondo");
      const inizio = Math.floor((i * passo) / 4) * 4 + 3;
      for (let x = inizio; x < (i + 1) * passo; x += 4) {
        ctx.fillRect(x, 0, 1, altezza);
      }
    }
    ctx.restore();
  });
  ctx.restore();
}

// sulla linea del tempo: la cornice ambra del pezzo da salvare,
// con la parte che non si salva più scura
function aggiornaSegniTaglio(file) {
  const durata = file.durata || 1;
  const inizio = file.taglio ? file.taglio.inizio / durata : 0;
  const fine = file.taglio ? file.taglio.fine / durata : 1;
  $("fuori-prima").style.width = inizio * 100 + "%";
  $("fuori-dopo").style.left = fine * 100 + "%";
  $("fuori-dopo").style.width = (1 - fine) * 100 + "%";
  $("cornice-taglio").style.left = inizio * 100 + "%";
  $("cornice-taglio").style.width = (fine - inizio) * 100 + "%";
  $("linea-tempo").classList.toggle("con-taglio", Boolean(file.taglio));
}

// clic sulla striscia: l'anteprima va in quel punto del video
function cliccaStriscia(evento) {
  const box = $("striscia").getBoundingClientRect();
  const posizione = Math.min(1, Math.max(0, (evento.clientX - box.left) / box.width));
  $("cursore-anteprima").value = Math.round(posizione * 1000);
  aggiornaTempoCursore();
  caricaAnteprima();
}

// ==========================================
// ZONE A MANO (per i tratti dove il display non si trova)
// ==========================================

// quando si disegna una zona a mano: quale si modifica (-1 = una nuova)
// e da che secondo a che secondo vale
let fissaInModifica = null;

// il tratto rosso o arancione attorno a quel secondo, con mezzo secondo in più
// per parte. Se lì è tutto verde: 2 secondi prima e dopo.
function trattoAttorno(file, secondi) {
  const c = file.copertura;
  const durata = file.durata;
  if (c && c.stati.length > 0) {
    const totale = Math.max(c.totali, c.stati.length);
    const i = Math.min(c.stati.length - 1, Math.floor((secondi / durata) * totale));
    const stato = c.stati[i];
    if (stato < 2) {
      let primo = i;
      let ultimo = i;
      while (primo > 0 && c.stati[primo - 1] === stato) primo--;
      while (ultimo < c.stati.length - 1 && c.stati[ultimo + 1] === stato) ultimo++;
      return {
        inizio: Math.max(0, (primo / totale) * durata - 0.5),
        fine: Math.min(durata, ((ultimo + 1) / totale) * durata + 0.5),
      };
    }
  }
  return { inizio: Math.max(0, secondi - 2), fine: Math.min(durata, secondi + 2) };
}

// apre il disegno di una zona a mano: indice = quella da modificare, -1 = nuova
function apriZonaFissa(indice) {
  const file = coda[indiceAnteprima];
  if (!file || file.foto || regolazioneAperta || !ultimaAnteprima) {
    return;
  }
  file.zoneFisse = file.zoneFisse || [];
  let zona;
  let tempi;
  if (indice >= 0) {
    const z = file.zoneFisse[indice];
    zona = { x: z.x, y: z.y, w: z.w, h: z.h };
    tempi = { inizio: z.inizio, fine: z.fine };
  } else {
    // si parte dalla zona di adesso, o dall'ultima trovata, o dal centro in basso
    zona = ultimaAnteprima.zona || file.ultimaZona || { x: 0.4, y: 0.62, w: 0.2, h: 0.12 };
    tempi = trattoAttorno(file, secondiCursore(file));
  }
  const segui = indice >= 0 ? file.zoneFisse[indice].segui === true : false;
  fissaInModifica = { indice: indice, inizio: tempi.inizio, fine: tempi.fine, segui: segui };
  aggiornaSegmentato("scelta-segui", segui ? "segue" : "ferma");

  fermaAnimazione();
  regolazioneAperta = true;
  zonaInModifica = Object.assign({}, zona);
  $("schermata-pronto").classList.add("regolazione-aperta");
  $("barra-regola").classList.add("modo-fissa");
  $("barra-regola").classList.remove("nascosto");
  $("btn-fissa-elimina").classList.toggle("nascosto", indice < 0);
  $("anteprima-zona").classList.add("fissa"); // la zona a mano è blu
  $("anteprima-carico").classList.add("nascosto"); // "Qui non trovo il display" coprirebbe la zona
  aggiornaTempiFissa();
  aggiornaZonaInModifica();
  ingrandisciSullaZona();
}

// "Ferma" o "Segue": con "Segue" la zona parte da questo fotogramma
// (dove l'hai disegnata) e va dietro all'oggetto finché lo vede
function cambiaSegui(valore) {
  const file = coda[indiceAnteprima];
  const f = fissaInModifica;
  f.segui = valore === "segue";
  aggiornaSegmentato("scelta-segui", valore);
  if (f.segui) {
    f.inizio = secondiCursore(file);
    f.fine = Math.min(file.durata, f.inizio + 60);
  } else {
    const tempi = trattoAttorno(file, secondiCursore(file));
    f.inizio = tempi.inizio;
    f.fine = tempi.fine;
  }
  aggiornaTempiFissa();
}

// "Dal 0:25 al 0:30" nella barra
function aggiornaTempiFissa() {
  $("fissa-inizio").textContent = formattaTempo(fissaInModifica.inizio);
  $("fissa-fine").textContent = formattaTempo(fissaInModifica.fine);
}

// i bottoni ‹ › accanto ai tempi: mezzo secondo prima o dopo
function cambiaTempoFissa(quale, passo) {
  const file = coda[indiceAnteprima];
  const f = fissaInModifica;
  if (quale === "inizio") {
    f.inizio = Math.min(f.fine - 0.5, Math.max(0, f.inizio + passo));
  } else {
    f.fine = Math.max(f.inizio + 0.5, Math.min(file.durata, f.fine + passo));
  }
  aggiornaTempiFissa();
}

function confermaZonaFissa() {
  const file = coda[indiceAnteprima];
  const f = fissaInModifica;
  const z = zonaInModifica;
  const nuova = { inizio: f.inizio, fine: f.fine, x: z.x, y: z.y, w: z.w, h: z.h, segui: f.segui };
  if (f.indice >= 0) {
    file.zoneFisse[f.indice] = nuova;
  } else {
    file.zoneFisse.push(nuova);
  }
  chiudiRegolazione();
  dopoZoneFisse();
  // una zona nuova su un tratto da controllare: si passa al prossimo
  if (f.indice < 0 && !nuova.segui && elencoProblemi(file).length > 0) {
    vaiAlProblemaVicino(true);
  }
}

function eliminaZonaFissa(indice) {
  const file = coda[indiceAnteprima];
  file.zoneFisse.splice(indice, 1);
  if (regolazioneAperta) {
    chiudiRegolazione();
  }
  dopoZoneFisse();
}

// dopo ogni cambio: lista, striscia, pallini della coda e anteprima
function dopoZoneFisse() {
  disegnaZoneFisse();
  disegnaStriscia();
  disegnaCodaSeFerma();
  caricaAnteprima();
}

// l'elenco delle zone a mano nel pannello
function disegnaZoneFisse() {
  const file = coda[indiceAnteprima];
  const lista = $("lista-fisse");
  lista.innerHTML = "";
  const zone = file && !file.foto ? file.zoneFisse || [] : [];
  $("riga-fisse").classList.toggle("nascosto", !file || file.foto);
  $("testo-fisse").textContent = zone.length === 0 ? "Nessuna" : zone.length === 1 ? t("1 zona") : t("{n} zone", { n: zone.length });
  // i tratti segnati «Va bene così», con il modo di annullarli
  const confermati = file && !file.foto ? (file.confermati || []).length : 0;
  if (confermati > 0) {
    const riga = document.createElement("div");
    riga.className = "riga-fissa";
    const testo = document.createElement("span");
    testo.className = "confermati";
    testo.textContent = confermati === 1 ? t("1 tratto «Va bene così»") : t("{n} tratti «Va bene così»", { n: confermati });
    const annulla = document.createElement("button");
    annulla.className = "link";
    annulla.textContent = "Annulla";
    annulla.addEventListener("click", annullaConfermati);
    riga.appendChild(testo);
    riga.appendChild(annulla);
    lista.appendChild(riga);
  }
  zone.forEach((z, i) => {
    const riga = document.createElement("div");
    riga.className = "riga-fissa";
    const tempi = document.createElement("button");
    tempi.className = "link";
    tempi.textContent = formattaTempo(z.inizio) + " – " + formattaTempo(z.fine);
    tempi.title = "Vai e modifica";
    // "segue": parte dal punto dove l'hai disegnata
    const punto = z.segui ? z.inizio : (z.inizio + z.fine) / 2;
    tempi.addEventListener("click", () => {
      vaiAlPunto(punto / file.durata);
      apriZonaFissa(i);
    });
    const togli = document.createElement("button");
    togli.className = "bottone-icona piccolo";
    togli.title = "Elimina";
    togli.setAttribute("aria-label", t("Elimina") + " " + formattaTempo(z.inizio));
    togli.innerHTML = icona("x");
    togli.addEventListener("click", () => eliminaZonaFissa(i));
    const tipo = document.createElement("span");
    tipo.className = "tipo-fissa";
    tipo.textContent = z.segui ? t("segue") : t("ferma");
    tempi.appendChild(tipo);
    riga.appendChild(tempi);
    riga.appendChild(togli);
    lista.appendChild(riga);
  });
}

// ==========================================
// LINEA DEL TEMPO: FOTOGRAMMI E MANIGLIE DEL TAGLIO
// ==========================================

// quanti fotogrammi piccoli nella linea del tempo
const NUMERO_FOTOGRAMMI = 12;
// i file che aspettano le miniature (si chiedono una alla volta)
let fileMiniature = [];
let miniatureInCorso = false;

// chiede le miniature di un file (una volta sola)
function chiediMiniature(file) {
  if (!file || file.miniature || fileMiniature.includes(file)) {
    return;
  }
  fileMiniature.push(file);
  prossimeMiniature();
}

async function prossimeMiniature() {
  if (miniatureInCorso || fileMiniature.length === 0) {
    return;
  }
  // prima quello mostrato nell'anteprima
  const mostrato = coda[indiceAnteprima];
  const file = fileMiniature.includes(mostrato) ? mostrato : fileMiniature[0];
  fileMiniature = fileMiniature.filter((f) => f !== file);
  miniatureInCorso = true;
  try {
    file.miniature = await invoke("miniature", {
      percorso: file.percorso,
      quante: file.foto ? 1 : NUMERO_FOTOGRAMMI,
      altezza: 96,
    });
  } catch (e) {
    file.miniature = []; // niente miniature: resta l'icona
  }
  miniatureInCorso = false;
  if (file === coda[indiceAnteprima]) {
    disegnaFotogrammi(file);
  }
  disegnaCodaSeFerma();
  prossimeMiniature();
}

// la fila di fotogrammi della linea del tempo
function disegnaFotogrammi(file) {
  const contenitore = $("fotogrammi");
  contenitore.innerHTML = "";
  if (!file || file.foto) {
    return;
  }
  if (!file.miniature) {
    chiediMiniature(file);
  }
  for (let i = 0; i < NUMERO_FOTOGRAMMI; i++) {
    const src = file.miniature ? file.miniature[i] : null;
    if (src) {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "";
      contenitore.appendChild(img);
    } else {
      const vuoto = document.createElement("span");
      vuoto.className = "fotogramma-vuoto";
      contenitore.appendChild(vuoto);
    }
  }
  aggiornaSegniTaglio(file);
}

// trascinare le maniglie [ ] del pezzo da salvare
let manigliaTaglio = null;

function iniziaManiglia(evento) {
  const file = coda[indiceAnteprima];
  if (!file || file.foto || evento.button !== 0) {
    return;
  }
  evento.preventDefault();
  evento.stopPropagation();
  manigliaTaglio = evento.target.id === "maniglia-inizio" ? "inizio" : "fine";
  evento.target.setPointerCapture(evento.pointerId);
}

function muoviManiglia(evento) {
  const file = coda[indiceAnteprima];
  if (!manigliaTaglio || !file) {
    return;
  }
  const r = $("linea-tempo").getBoundingClientRect();
  const secondi = Math.min(1, Math.max(0, (evento.clientX - r.left) / r.width)) * file.durata;
  const taglio = file.taglio ? Object.assign({}, file.taglio) : { inizio: 0, fine: file.durata };
  // il pezzo dura almeno 1 secondo
  if (manigliaTaglio === "inizio") {
    taglio.inizio = Math.min(secondi, taglio.fine - 1);
  } else {
    taglio.fine = Math.max(secondi, taglio.inizio + 1);
  }
  file.taglio = taglio;
  aggiornaSegniTaglio(file);
  aggiornaTaglio();
  // l'anteprima va dove sta la maniglia, così vedi il fotogramma
  vaiAlPunto((manigliaTaglio === "inizio" ? taglio.inizio : taglio.fine) / file.durata);
}

function fineManiglia() {
  const file = coda[indiceAnteprima];
  if (!manigliaTaglio || !file) {
    return;
  }
  manigliaTaglio = null;
  // tutto il video: niente taglio
  if (file.taglio && file.taglio.inizio < 0.2 && file.taglio.fine > file.durata - 0.2) {
    file.taglio = null;
  }
  aggiornaSchedaFile();
  disegnaStriscia();
  disegnaCodaSeFerma();
}

// ==========================================
// COPERTURA: STILE E MARGINE
// ==========================================

// mette a posto i controlli della copertura secondo le scelte
function aggiornaCopertura() {
  aggiornaSegmentato("scelta-stile", scelte.stile);
  // "Forza" serve solo per pixel e sfocatura
  const conForza = scelte.stile === "pixel" || scelte.stile === "sfocatura";
  $("riga-forza").classList.toggle("nascosto", !conForza);
  let nota = "Con «Guarda 3 s» vedi il risultato.";
  if (scelte.stile === "pixel") {
    nota = t("Più forza = quadrati più grandi.") + " " + t(nota);
  } else if (scelte.stile === "sfocatura") {
    nota = t("Più forza = più sfocato.") + " " + t(nota);
  }
  $("nota-copertura").textContent = nota;

  // margine: una delle tre misure o "Manuale"
  if (scelte.margineManuale) {
    aggiornaSegmentato("scelta-margine", "manuale");
  } else {
    aggiornaSegmentato("scelta-margine", scelte.margine);
  }
  $("riga-margine-manuale").classList.toggle("nascosto", !scelte.margineManuale);
  $("cursore-margine").value = Math.round(scelte.margine * 100);
  $("valore-margine").textContent = Math.round(scelte.margine * 100) + "%";
  aggiornaPannelloTutti();
}

// ==========================================
// PARTE DEL VIDEO (TAGLIO)
// ==========================================

// il punto del video dove sta il cursore, in secondi
function secondiCursore(file) {
  return (Number($("cursore-anteprima").value) / 1000) * file.durata;
}

// nel pannello: "Tutto il video" oppure "0:12 – 1:40"
function aggiornaTaglio() {
  const file = coda[indiceAnteprima];
  $("riga-parte").classList.toggle("nascosto", !file || file.foto);
  if (!file || file.foto) {
    return;
  }
  aggiornaSegniTaglio(file);
  if (file.taglio) {
    $("testo-parte").textContent = formattaTempo(file.taglio.inizio) + " – " + formattaTempo(file.taglio.fine);
  } else {
    $("testo-parte").textContent = "Tutto il video";
  }
  $("btn-tutto-video").classList.toggle("nascosto", !file.taglio);
}

// "1:12 / 3:04" sotto il cursore (e la linea del punto attuale)
function aggiornaTempoCursore() {
  $("testina").style.left = Number($("cursore-anteprima").value) / 10 + "%";
  aggiornaBarraProblemi();
  const file = coda[indiceAnteprima];
  if (!file || file.foto) {
    return;
  }
  $("tempo-cursore").textContent = formattaTempo(secondiCursore(file)) + " / " + formattaTempo(file.durata);
}

// frecce: sposta il cursore di qualche secondo
function spostaCursore(secondi) {
  const file = coda[indiceAnteprima];
  if (!file || file.foto || !file.durata) {
    return;
  }
  const ora = secondiCursore(file);
  vaiAlPunto((ora + secondi) / file.durata);
}

// "Inizio qui" (inizio = true) o "Fine qui" (inizio = false)
function segnaTaglio(inizio) {
  const file = coda[indiceAnteprima];
  if (!file || file.foto) {
    return;
  }
  const punto = secondiCursore(file);
  const taglio = file.taglio ? Object.assign({}, file.taglio) : { inizio: 0, fine: file.durata };
  if (inizio) {
    taglio.inizio = punto;
  } else {
    taglio.fine = punto;
  }
  if (taglio.fine - taglio.inizio < 1) {
    $("testo-anteprima").textContent = "Il pezzo deve durare almeno 1 secondo: l'inizio va prima della fine.";
    return;
  }
  // dall'inizio alla fine = nessun taglio
  if (taglio.inizio < 0.05 && taglio.fine > file.durata - 0.05) {
    file.taglio = null;
  } else {
    file.taglio = taglio;
  }
  aggiornaSchedaFile();
}

function togliTaglio() {
  coda[indiceAnteprima].taglio = null;
  aggiornaSchedaFile();
}

// ==========================================
// MINI ANTEPRIMA ANIMATA
// ==========================================

let timerAnimazione = null;
let numeroAnimazione = 0;

async function avviaAnimazione() {
  if (timerAnimazione) {
    fermaAnimazione();
    return;
  }
  const file = coda[indiceAnteprima];
  if (!file || file.foto) {
    return;
  }
  numeroAnimazione++;
  const mioNumero = numeroAnimazione;
  $("btn-animazione").disabled = true;
  $("btn-animazione").querySelector("span").textContent = "Preparo…";
  try {
    const immagini = await invoke("anteprima_animata", {
      percorso: file.percorso,
      posizione: Number($("cursore-anteprima").value) / 1000,
      forza: Number(scelte.forza),
      margine: Number(scelte.margine),
      display: sceltaDisplay(file),
      fisse: file.zoneFisse || [],
    });
    if (mioNumero !== numeroAnimazione) {
      return; // nel frattempo è cambiato qualcosa
    }
    // fa girare le immagini: 10 al secondo, all'infinito
    let indice = 0;
    $("animazione-img").src = immagini[0];
    $("animazione-img").classList.remove("nascosto");
    $("anteprima").classList.add("animazione-attiva");
    timerAnimazione = setInterval(() => {
      indice = (indice + 1) % immagini.length;
      $("animazione-img").src = immagini[indice];
    }, 100);
    $("btn-animazione").innerHTML = icona("stop") + "<span>Ferma</span>";
    $("btn-animazione").disabled = false;
  } catch (errore) {
    if (mioNumero === numeroAnimazione) {
      $("testo-anteprima").textContent = t("Anteprima animata non disponibile:") + " " + errore;
      fermaAnimazione();
    }
  }
}

function fermaAnimazione() {
  numeroAnimazione++;
  if (timerAnimazione) {
    clearInterval(timerAnimazione);
    timerAnimazione = null;
  }
  $("animazione-img").classList.add("nascosto");
  $("anteprima").classList.remove("animazione-attiva");
  $("btn-animazione").disabled = false;
  $("btn-animazione").innerHTML = icona("play") + "<span>Guarda 3 s</span>";
}

// ==========================================
// CODA: RIORDINARE TRASCINANDO
// ==========================================

let rigaTrascinata = null;
// true subito dopo un trascinamento: il "clic" che segue va ignorato
let rigaAppenaSpostata = false;

function iniziaTrascinaRiga(evento, riga) {
  if (evento.button !== 0 || evento.target.closest(".bottone-icona")) {
    return; // la ✕ non fa partire il trascinamento
  }
  rigaTrascinata = { riga: riga, y: evento.clientY, spostata: false };
  // il mouse si segue su tutta la finestra (la riga cambia posto nella lista)
  window.addEventListener("pointermove", trascinaRiga);
  window.addEventListener("pointerup", fineTrascinaRiga);
}

function trascinaRiga(evento) {
  if (!rigaTrascinata) {
    return;
  }
  // parte solo dopo qualche pixel, così un clic resta un clic
  if (!rigaTrascinata.spostata && Math.abs(evento.clientY - rigaTrascinata.y) < 5) {
    return;
  }
  rigaTrascinata.spostata = true;
  const riga = rigaTrascinata.riga;
  riga.classList.add("trascinata");
  // mette la riga prima della prima riga che ha il centro sotto il mouse
  const lista = $("lista-coda");
  const altre = [...lista.children].filter((r) => r !== riga);
  let prima = null;
  for (const altra of altre) {
    const box = altra.getBoundingClientRect();
    if (evento.clientY < box.top + box.height / 2) {
      prima = altra;
      break;
    }
  }
  lista.insertBefore(riga, prima);
}

// ⌥↑ / ⌥↓: sposta un file della coda in su o in giù
function spostaInCoda(indice, direzione) {
  const nuovo = indice + direzione;
  if (indice < 0 || nuovo < 0 || nuovo >= coda.length) {
    return;
  }
  const mostrato = coda[indiceAnteprima];
  const file = coda[indice];
  coda[indice] = coda[nuovo];
  coda[nuovo] = file;
  indiceAnteprima = coda.indexOf(mostrato);
  aggiornaSchedaFile();
  // la riga resta selezionata con la tastiera
  const riga = $("lista-coda").children[nuovo];
  if (riga) {
    riga.focus();
  }
}

function fineTrascinaRiga() {
  window.removeEventListener("pointermove", trascinaRiga);
  window.removeEventListener("pointerup", fineTrascinaRiga);
  if (!rigaTrascinata) {
    return;
  }
  const spostata = rigaTrascinata.spostata;
  rigaTrascinata.riga.classList.remove("trascinata");
  rigaTrascinata = null;
  if (!spostata) {
    return;
  }
  rigaAppenaSpostata = true;
  // il nuovo ordine è quello delle righe nella lista
  const mostrato = coda[indiceAnteprima];
  coda = [...$("lista-coda").children].map((r) => coda[Number(r.dataset.indice)]);
  indiceAnteprima = coda.indexOf(mostrato);
  aggiornaSchedaFile();
  // il "clic" del trascinamento arriva subito dopo; se non arriva, il prossimo clic vale
  setTimeout(() => {
    rigaAppenaSpostata = false;
  }, 0);
}

// ==========================================
// REGOLA LA ZONA A MANO
// ==========================================

let regolazioneAperta = false;
// la zona mentre la regoli: x, y, w, h da 0 a 1 (rispetto all'immagine)
let zonaInModifica = null;
// cosa si sta trascinando (null = niente)
let trascinamento = null;
// quanto è ingrandita l'anteprima
let scalaTela = 1;
// "questo" = la zona vale solo per questo video, "tutti" = per tutta la coda
let valeRegolazione = "questo";

function apriRegolazione() {
  if (regolazioneAperta) {
    return;
  }
  // qui vale una zona disegnata a mano: si modifica quella
  const file = coda[indiceAnteprima];
  if (ultimaAnteprima && ultimaAnteprima.fissa && file && !file.foto) {
    const zona = zonaFissaA(file, secondiCursore(file));
    if (zona) {
      apriZonaFissa(file.zoneFisse.indexOf(zona));
      return;
    }
  }
  if (!ultimaAnteprima || !ultimaAnteprima.zona_base) {
    $("testo-anteprima").textContent =
      "Qui il display non viene trovato: sposta il cursore su un punto verde della striscia, poi premi «Regola…».";
    return;
  }
  fermaAnimazione();
  regolazioneAperta = true;
  fissaInModifica = null;
  zonaInModifica = Object.assign({}, ultimaAnteprima.zona);
  $("schermata-pronto").classList.add("regolazione-aperta");
  $("barra-regola").classList.remove("modo-fissa");
  $("barra-regola").classList.remove("nascosto");
  // con un solo file "Vale per" non serve
  valeRegolazione = "questo";
  aggiornaSegmentato("scelta-vale", valeRegolazione);
  $("scelta-vale").classList.toggle("nascosto", coda.length < 2);
  $("barra-regola").querySelector(".vale-per").classList.toggle("nascosto", coda.length < 2);
  aggiornaZonaInModifica();
  ingrandisciSullaZona();
}

function chiudiRegolazione() {
  regolazioneAperta = false;
  fissaInModifica = null;
  trascinamento = null;
  $("schermata-pronto").classList.remove("regolazione-aperta");
  $("barra-regola").classList.add("nascosto");
  scalaTela = 1;
  $("anteprima-tela").style.transform = "";
  $("anteprima-tela").style.setProperty("--scala", 1);
  if (ultimaAnteprima) {
    posizionaZona($("anteprima-img"), $("anteprima-zona"), ultimaAnteprima.zona);
    $("anteprima-zona").classList.toggle("fissa", ultimaAnteprima.fissa === true);
  }
}

// i file a cui va la regolazione: solo quello mostrato o tutta la coda
function fileDaRegolare() {
  return valeRegolazione === "tutti" ? coda : [coda[indiceAnteprima]];
}

// "Applica": salva lo spostamento e la grandezza rispetto alla zona automatica
function confermaRegolazione() {
  if (fissaInModifica) {
    confermaZonaFissa(); // si sta disegnando una zona a mano
    return;
  }
  const base = ultimaAnteprima.zona_base;
  const z = zonaInModifica;
  const regolazione = {
    dx: (z.x + z.w / 2 - (base.x + base.w / 2)) / base.w,
    dy: (z.y + z.h / 2 - (base.y + base.h / 2)) / base.h,
    larghezza: z.w / base.w,
    altezza: z.h / base.h,
  };
  for (const file of fileDaRegolare()) {
    file.regolazione = Object.assign({}, regolazione);
  }
  chiudiRegolazione();
  aggiornaSchedaFile();
  caricaAnteprima();
}

// "Ripristina": torna alla zona automatica
function ripristinaRegolazione() {
  for (const file of fileDaRegolare()) {
    file.regolazione = null;
  }
  chiudiRegolazione();
  aggiornaSchedaFile();
  caricaAnteprima();
}

function aggiornaZonaInModifica() {
  posizionaZona($("anteprima-img"), $("anteprima-zona"), zonaInModifica);
}

// ingrandisce l'anteprima sulla zona, così si regola con precisione
function ingrandisciSullaZona() {
  const img = $("anteprima-img");
  const g = geometriaImmagine(img);
  const z = zonaInModifica;
  const larghezzaZona = z.w * g.larghezza;
  const altezzaZona = z.h * g.altezza;
  // centro della zona dentro la tela
  const centroX = g.sinistra + (z.x + z.w / 2) * g.larghezza;
  const centroY = g.sopra + (z.y + z.h / 2) * g.altezza;

  // la zona deve occupare circa un terzo dell'anteprima (al massimo 4 volte più grande)
  let scala = (Math.min(img.clientWidth, img.clientHeight) * 0.3) / Math.max(larghezzaZona, altezzaZona);
  scala = Math.min(4, Math.max(1, scala));
  // sposta in modo che la zona finisca al centro (un po' più in alto, sopra la barra)
  const spostaX = img.clientWidth / 2 - scala * centroX;
  const spostaY = img.clientHeight / 2 - 20 - scala * centroY;

  scalaTela = scala;
  $("anteprima-tela").style.transform = "translate(" + spostaX + "px, " + spostaY + "px) scale(" + scala + ")";
  $("anteprima-tela").style.setProperty("--scala", scala);
}

// inizia a trascinare la zona o una maniglia
function iniziaTrascinamento(evento) {
  if (!regolazioneAperta) {
    return;
  }
  evento.preventDefault();
  const maniglia = evento.target.closest(".maniglia");
  trascinamento = {
    lato: maniglia ? maniglia.dataset.lato : "sposta",
    x: evento.clientX,
    y: evento.clientY,
    zona: Object.assign({}, zonaInModifica),
  };
  $("anteprima-zona").setPointerCapture(evento.pointerId);
}

function trascina(evento) {
  if (!trascinamento) {
    return;
  }
  const g = geometriaImmagine($("anteprima-img"));
  // spostamento del mouse, da pixel dello schermo a "parte dell'immagine"
  const dx = (evento.clientX - trascinamento.x) / scalaTela / g.larghezza;
  const dy = (evento.clientY - trascinamento.y) / scalaTela / g.altezza;
  const lato = trascinamento.lato;
  let x = trascinamento.zona.x;
  let y = trascinamento.zona.y;
  let w = trascinamento.zona.w;
  let h = trascinamento.zona.h;
  const minimo = 0.01;

  if (lato === "sposta") {
    // tutta la zona, senza uscire dall'immagine
    x = Math.min(1 - w, Math.max(0, x + dx));
    y = Math.min(1 - h, Math.max(0, y + dy));
  } else {
    // un lato o un angolo: "nw" = in alto a sinistra, "se" = in basso a destra...
    if (lato.includes("w")) {
      const nuovaX = Math.min(x + w - minimo, Math.max(0, x + dx));
      w = w + (x - nuovaX);
      x = nuovaX;
    }
    if (lato.includes("e")) {
      w = Math.min(1 - x, Math.max(minimo, w + dx));
    }
    if (lato.includes("n")) {
      const nuovaY = Math.min(y + h - minimo, Math.max(0, y + dy));
      h = h + (y - nuovaY);
      y = nuovaY;
    }
    if (lato.includes("s")) {
      h = Math.min(1 - y, Math.max(minimo, h + dy));
    }
  }
  zonaInModifica = { x: x, y: y, w: w, h: h };
  aggiornaZonaInModifica();
}

function fineTrascinamento() {
  trascinamento = null;
}

// frecce durante la regolazione: spostano la zona;
// con Maiusc cambiano la grandezza (→ più larga, ↓ più alta)
function tastoRegolazione(tasto, grandezza) {
  const passo = 0.002;
  let x = zonaInModifica.x;
  let y = zonaInModifica.y;
  let w = zonaInModifica.w;
  let h = zonaInModifica.h;
  let dx = 0;
  let dy = 0;
  if (tasto === "ArrowLeft") dx = -passo;
  if (tasto === "ArrowRight") dx = passo;
  if (tasto === "ArrowUp") dy = -passo;
  if (tasto === "ArrowDown") dy = passo;
  if (grandezza) {
    w = Math.min(1 - x, Math.max(0.01, w + dx * 2));
    h = Math.min(1 - y, Math.max(0.01, h + dy * 2));
  } else {
    x = Math.min(1 - w, Math.max(0, x + dx));
    y = Math.min(1 - h, Math.max(0, y + dy));
  }
  zonaInModifica = { x: x, y: y, w: w, h: h };
  aggiornaZonaInModifica();
}

// ==========================================
// IMPOSTAZIONI: DISPLAY
// ==========================================

// mette in evidenza il colore scelto
function aggiornaColori() {
  for (const b of $("scelta-colore").querySelectorAll("button")) {
    b.classList.toggle("attivo", b.dataset.valore === scelte.colore);
  }
  // il pallino accanto a "Colore preso dal video"
  const pallino = $("pallino-video");
  if (scelte.colore === "video") {
    pallino.style.background = rgbInTesto(scelte.coloreVideo);
    pallino.classList.add("attivo");
    pallino.classList.remove("nascosto");
  } else {
    pallino.classList.add("nascosto");
  }
}

// ==========================================
// SCEGLI IL COLORE DAL VIDEO
// ==========================================

// il colore cliccato (null finché non si clicca)
let coloreCliccato = null;
let timerScegli = null;

function apriScegliColore() {
  if (coda.length === 0) {
    $("nota-display").textContent = "Per prendere il colore dal video, prima aggiungi un video o una foto.";
    return;
  }
  coloreCliccato = null;
  $("scegli-pallino").classList.add("nascosto");
  $("scegli-mirino").classList.add("nascosto");
  $("btn-scegli-usa").disabled = true;
  $("scegli-fumetto").textContent = "Clicca sul display della moto";
  // parte dallo stesso punto dell'anteprima; con una foto il cursore non serve
  $("cursore-scegli").value = $("cursore-anteprima").value;
  $("cursore-scegli").classList.toggle("nascosto", coda[indiceAnteprima].foto);
  mostraSchermata("scegli");
  caricaFotogrammaScegli();
}

async function caricaFotogrammaScegli() {
  const file = coda[indiceAnteprima];
  try {
    const risposta = await invoke("anteprima", {
      percorso: file.percorso,
      posizione: Number($("cursore-scegli").value) / 1000,
      forza: Number(scelte.forza),
      margine: Number(scelte.margine),
      display: sceltaDisplay(coda[indiceAnteprima]),
    });
    $("scegli-img").src = risposta.immagine;
    $("scegli-mirino").classList.add("nascosto");
  } catch (errore) {
    $("scegli-fumetto").textContent = t("Anteprima non disponibile:") + " " + errore;
  }
}

// clic sull'immagine: prende il colore in quel punto
function cliccaSulVideo(evento) {
  const img = $("scegli-img");
  if (!img.naturalWidth) {
    return;
  }
  // l'immagine è "contain": calcolo dove finisce davvero dentro il riquadro nero
  const box = img.getBoundingClientRect();
  const scala = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight);
  const sinistra = (box.width - img.naturalWidth * scala) / 2;
  const sopra = (box.height - img.naturalHeight * scala) / 2;
  const xClic = evento.clientX - box.left;
  const yClic = evento.clientY - box.top;
  // punto cliccato nell'immagine vera
  const x = Math.round((xClic - sinistra) / scala);
  const y = Math.round((yClic - sopra) / scala);
  if (x < 0 || y < 0 || x >= img.naturalWidth || y >= img.naturalHeight) {
    return; // clic sulle bande nere
  }

  // per leggere i pixel disegno l'immagine su una tela (non si vede)
  const tela = document.createElement("canvas");
  tela.width = img.naturalWidth;
  tela.height = img.naturalHeight;
  const ctx = tela.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // un quadratino 7x7 attorno al clic (un pixel solo potrebbe essere sbagliato)
  const x0 = Math.min(Math.max(0, x - 3), tela.width - 7);
  const y0 = Math.min(Math.max(0, y - 3), tela.height - 7);
  const dati = ctx.getImageData(Math.max(0, x0), Math.max(0, y0), 7, 7).data;

  // media dei pixel non scuri (così le cifre nere non contano)
  let somma = [0, 0, 0];
  let quanti = 0;
  for (let i = 0; i < dati.length; i += 4) {
    if (Math.max(dati[i], dati[i + 1], dati[i + 2]) >= 80) {
      somma[0] += dati[i];
      somma[1] += dati[i + 1];
      somma[2] += dati[i + 2];
      quanti++;
    }
  }
  if (quanti === 0) {
    $("scegli-fumetto").textContent = "Qui è troppo scuro: clicca sulla parte accesa del display";
    return;
  }
  coloreCliccato = [
    Math.round(somma[0] / quanti),
    Math.round(somma[1] / quanti),
    Math.round(somma[2] / quanti),
  ];

  // mostra il mirino e il colore scelto
  $("scegli-mirino").style.left = xClic + "px";
  $("scegli-mirino").style.top = yClic + "px";
  $("scegli-mirino").classList.remove("nascosto");
  $("scegli-pallino").style.background = rgbInTesto(coloreCliccato);
  $("scegli-pallino").classList.remove("nascosto");
  $("scegli-fumetto").textContent = "Clicca sul display della moto";
  $("btn-scegli-usa").disabled = false;
}

function usaColoreCliccato() {
  scelte.colore = "video";
  scelte.coloreVideo = coloreCliccato;
  salvaScelte();
  aggiornaColori();
  mostraSchermata("impostazioni");
}

// ==========================================
// TASTIERA
// ==========================================

// true se il tasto è stato premuto su un bottone o una casella
// (lì Spazio e Invio fanno già la loro cosa)
function suBottone(bersaglio) {
  return bersaglio.tagName === "BUTTON" || (bersaglio.tagName === "INPUT" && bersaglio.type !== "range");
}

function tastoPremuto(evento) {
  const tasto = evento.key;
  const comando = evento.metaKey || evento.ctrlKey;
  const bersaglio = evento.target;

  // "Come funziona": Esc chiude, Invio va avanti
  if (passoGuida >= 0) {
    if (tasto === "Escape") {
      chiudiGuida();
    }
    return;
  }

  // con la domanda aperta valgono solo Invio ed Esc
  if (rispostaDialogo) {
    if (tasto === "Escape") {
      evento.preventDefault();
      chiudiDialogo(null); // Esc = nessuna scelta (non fa niente)
    } else if (tasto === "Enter" && bersaglio === $("dialogo-campo")) {
      chiudiDialogo(true); // Invio nella casella = conferma
    }
    return;
  }

  // Esc esce dallo schermo intero prima di tutto il resto
  if (tasto === "Escape" && schermoIntero) {
    cambiaSchermoIntero();
    return;
  }

  // ⌘O, ⌘⇧O, ⌘, e ⌘↩ (sul Mac li fa già il menu)
  if (comando && !menuAttivo) {
    if (tasto.toLowerCase() === "o" && !alLavoro) {
      evento.preventDefault();
      if (evento.shiftKey) {
        scegliCartella();
      } else {
        scegliFile();
      }
      return;
    }
    if (tasto === ",") {
      evento.preventDefault();
      apriImpostazioni();
      return;
    }
    if (tasto === "Enter" && suSchermata("pronto") && !regolazioneAperta) {
      evento.preventDefault();
      avvia();
      return;
    }
  }

  // mentre regoli la zona: Invio applica, Esc annulla, frecce spostano
  if (regolazioneAperta) {
    if (tasto === "Escape") {
      chiudiRegolazione();
    } else if (tasto === "Enter" && !suBottone(bersaglio)) {
      confermaRegolazione();
    } else if (tasto.startsWith("Arrow")) {
      evento.preventDefault();
      tastoRegolazione(tasto, evento.shiftKey);
    }
    return;
  }

  if (tasto === "Escape") {
    if (suSchermata("impostazioni")) {
      chiudiImpostazioni();
    } else if (suSchermata("scegli")) {
      mostraSchermata("impostazioni");
    } else if (animazioneInCorso()) {
      fermaAnimazione();
    }
    return;
  }

  // da qui in giù: solo nella schermata con l'anteprima
  if (!suSchermata("pronto") || comando) {
    return;
  }
  const file = coda[indiceAnteprima];
  const suCursore = bersaglio === document.body || bersaglio === $("cursore-anteprima");
  const suStriscia = bersaglio === $("striscia");

  // ⌥↑ ⌥↓: cambia l'ordine della coda (la riga selezionata o il video mostrato)
  if (evento.altKey && (tasto === "ArrowUp" || tasto === "ArrowDown")) {
    evento.preventDefault();
    const riga = bersaglio.closest ? bersaglio.closest("#lista-coda .riga-file") : null;
    const indice = riga ? Number(riga.dataset.indice) : indiceAnteprima;
    spostaInCoda(indice, tasto === "ArrowUp" ? -1 : 1);
    return;
  }
  // Canc su una riga della coda: la toglie
  const rigaCoda = bersaglio.closest ? bersaglio.closest("#lista-coda .riga-file") : null;
  if ((tasto === "Backspace" || tasto === "Delete") && rigaCoda) {
    evento.preventDefault();
    togliDallaCoda(Number(rigaCoda.dataset.indice));
    return;
  }
  // F: schermo intero · R: originale o risultato (anche con le foto)
  if (tasto.toLowerCase() === "f" && !evento.altKey) {
    cambiaSchermoIntero();
    return;
  }
  if (tasto.toLowerCase() === "r" && !evento.altKey) {
    scambiaVista();
    return;
  }
  if (!file || file.foto) {
    return;
  }
  // sulla striscia le frecce saltano ai punti da controllare
  if (suStriscia && (tasto === "ArrowLeft" || tasto === "ArrowRight")) {
    evento.preventDefault();
    saltaAlTratto(tasto === "ArrowRight");
    return;
  }
  // ← → : 1 secondo (con Maiusc 10 secondi)
  if (suCursore && (tasto === "ArrowLeft" || tasto === "ArrowRight")) {
    evento.preventDefault();
    const secondi = evento.shiftKey ? 10 : 1;
    spostaCursore(tasto === "ArrowRight" ? secondi : -secondi);
    return;
  }
  if (evento.altKey) {
    return;
  }
  // I e O: inizio e fine del pezzo da salvare
  if (tasto.toLowerCase() === "i") {
    segnaTaglio(true);
  } else if (tasto.toLowerCase() === "o") {
    segnaTaglio(false);
  } else if (tasto === " " && !suBottone(bersaglio)) {
    evento.preventDefault();
    avviaAnimazione(); // Spazio: guarda 3 secondi (o ferma)
  }
}

function animazioneInCorso() {
  return timerAnimazione !== null;
}

// l'elenco delle scorciatoie (Aiuto › Scorciatoie da tastiera)
const SCORCIATOIE = [
  ["⌘O", "Aggiungi video o foto"],
  ["⌘⇧O", "Aggiungi una cartella"],
  ["⌘↩", "Avvia"],
  ["⌘,", "Impostazioni"],
  ["", ""],
  ["← →", "Un secondo avanti o indietro (con ⇧ 10 secondi)"],
  ["", "Frecce sulla striscia: al prossimo punto da controllare"],
  ["I  O", "Inizio e fine del pezzo da salvare"],
  ["Spazio", "Guarda 3 secondi"],
  ["R", "Originale o risultato"],
  ["F", "Schermo intero (Esc per uscire)"],
  ["⌥↑ ⌥↓", "Cambia l'ordine della coda"],
  ["", ""],
  ["", "Regola la zona: frecce per spostare, ⇧ + frecce per la grandezza, ↩ per applicare, Esc per annullare"],
];

function mostraScorciatoie() {
  const righe = SCORCIATOIE.map((r) => (r[0] ? r[0] + "   " : "") + (r[1] ? t(r[1]) : ""));
  chiedi(t("Scorciatoie da tastiera"), righe.join("\n"), "Ok", "");
}

// ==========================================
// CHIUSURA DELLA FINESTRA E MENU DEL MAC
// ==========================================

function preparaChiusura() {
  try {
    const finestra = tauri.window.getCurrentWindow();
    finestra.onCloseRequested(async (evento) => {
      if (!alLavoro) {
        return; // non sta lavorando: si chiude e basta
      }
      evento.preventDefault();
      const si = await chiedi("Chiudere Velocità?", "Sta ancora lavorando: il video in corso non verrà salvato.", "Chiudi", "Continua");
      if (!si) {
        return;
      }
      await invoke("interrompi");
      // aspetta che si fermi davvero (al massimo 5 secondi), così ffmpeg non resta acceso
      for (let i = 0; i < 50 && alLavoro; i++) {
        await new Promise((fatto) => setTimeout(fatto, 100));
      }
      await finestra.destroy();
    });
  } catch (e) {
    // senza questo la finestra si chiude come sempre
  }
}

// il menu in alto sul Mac (su Windows non c'è: lì bastano i bottoni)
async function creaMenuMac() {
  if (!navigator.userAgent.includes("Mac") || !tauri.menu) {
    return;
  }
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = tauri.menu;
    const voce = (testo, tasti, azione) => MenuItem.new({ text: t(testo), accelerator: tasti, action: azione });
    const fisso = (nome) => PredefinedMenuItem.new({ item: nome });

    const app = await Submenu.new({
      text: "Velocità",
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }),
        await voce("Controlla aggiornamenti…", undefined, () => controllaAggiornamenti(true)),
        await fisso("Separator"),
        await voce("Impostazioni…", "CmdOrCtrl+,", apriImpostazioni),
        await fisso("Separator"),
        await fisso("Hide"),
        await fisso("HideOthers"),
        await fisso("ShowAll"),
        await fisso("Separator"),
        await fisso("Quit"),
      ],
    });
    const archivio = await Submenu.new({
      text: t("File"),
      items: [
        await voce("Aggiungi video o foto…", "CmdOrCtrl+O", () => !alLavoro && scegliFile()),
        await voce("Aggiungi una cartella…", "CmdOrCtrl+Shift+O", () => !alLavoro && scegliCartella()),
        await fisso("Separator"),
        await voce("Avvia", "CmdOrCtrl+Enter", () => suSchermata("pronto") && !regolazioneAperta && avvia()),
        await fisso("Separator"),
        await fisso("CloseWindow"),
      ],
    });
    const modifica = await Submenu.new({
      text: t("Modifica"),
      items: [await fisso("Undo"), await fisso("Redo"), await fisso("Separator"), await fisso("Cut"), await fisso("Copy"), await fisso("Paste"), await fisso("SelectAll")],
    });
    const video = await Submenu.new({
      text: t("Video"),
      items: [
        await voce("Guarda 3 secondi", undefined, () => suSchermata("pronto") && avviaAnimazione()),
        await voce("Regola la zona…", undefined, () => suSchermata("pronto") && apriRegolazione()),
        await voce("Copri a mano qui…", undefined, () => suSchermata("pronto") && apriZonaFissa(-1)),
        await voce("Originale / Risultato", undefined, () => suSchermata("pronto") && scambiaVista()),
        await voce("Schermo intero", undefined, () => suSchermata("pronto") && cambiaSchermoIntero()),
        await fisso("Separator"),
        await voce("Inizio del pezzo qui", undefined, () => suSchermata("pronto") && segnaTaglio(true)),
        await voce("Fine del pezzo qui", undefined, () => suSchermata("pronto") && segnaTaglio(false)),
        await voce("Tutto il video", undefined, () => suSchermata("pronto") && togliTaglio()),
      ],
    });
    const finestra = await Submenu.new({
      text: t("Finestra"),
      items: [await fisso("Minimize"), await fisso("Maximize"), await fisso("Fullscreen")],
    });
    const aiuto = await Submenu.new({
      text: t("Aiuto"),
      items: [await voce("Come funziona", undefined, mostraGuida), await voce("Scorciatoie da tastiera", undefined, mostraScorciatoie)],
    });
    const menu = await Menu.new({ items: [app, archivio, modifica, video, finestra, aiuto] });
    await menu.setAsAppMenu();
    menuAttivo = true;
  } catch (e) {
    // se il menu non si riesce a creare, le scorciatoie funzionano lo stesso
    console.log("menu non creato", e);
  }
}

// ==========================================
// AVVIO: collega i bottoni
// ==========================================

// mette le scelte (salvate o di un preset) nei bottoni e nei cursori
function mettiScelteNeiControlli() {
  aggiornaSegmentato("scelta-cpu", scelte.usoCpu);
  aggiornaCopertura();
  aggiornaSegmentato("scelta-momento", scelte.momento);
  aggiornaSegmentato("scelta-posizione", scelte.posizione);
  aggiornaColori();
  $("cursore-forza").value = scelte.forza;
  $("valore-forza").textContent = scelte.forza + " px";
  $("interruttore-volti").checked = scelte.volti;
  disegnaPreset();
}

async function avvio() {
  caricaScelte();
  // la lingua: prima di tutto, così le scritte sono subito giuste
  scegliLingua(scelte.lingua);
  traduciPagina();
  applicaTema();

  // mette i valori salvati nei controlli
  mettiScelteNeiControlli();
  $("interruttore-aggiornamenti").checked = scelte.controllaAggiornamenti;

  // versione dell'app
  const versione = await tauri.app.getVersion();
  $("testo-versione").textContent = t("Versione {versione}", { versione: versione });

  // schermata 1
  $("btn-scegli").addEventListener("click", scegliFile);

  // trascina e rilascia sulla finestra
  tauri.webviewWindow.getCurrentWebviewWindow().onDragDropEvent((evento) => {
    const tipo = evento.payload.type;
    if (tipo === "enter" || tipo === "over") {
      $("zona-trascina").classList.add("attiva");
    } else if (tipo === "drop") {
      $("zona-trascina").classList.remove("attiva");
      aggiungiFile(evento.payload.paths);
    } else {
      $("zona-trascina").classList.remove("attiva");
    }
  });

  // schermata 2
  $("btn-cambia-file").addEventListener("click", scegliFile);
  $("btn-cambia-cartella").addEventListener("click", async () => {
    const cartella = await tauri.dialog.open({ directory: true });
    if (!cartella) {
      return; // annullato: non cambia niente
    }
    scelte.cartella = cartella;
    salvaScelte();
    aggiornaSchedaFile();
  });
  $("btn-reset-cartella").addEventListener("click", () => {
    scelte.cartella = "";
    salvaScelte();
    aggiornaSchedaFile();
  });
  $("cursore-anteprima").addEventListener("input", () => {
    aggiornaTempoCursore();
    clearTimeout(timerAnteprima);
    timerAnteprima = setTimeout(caricaAnteprima, 120);
  });
  $("scelta-cpu").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.usoCpu = b.dataset.valore;
      aggiornaSegmentato("scelta-cpu", scelte.usoCpu);
      salvaScelte();
    }
  });
  $("btn-avvia").addEventListener("click", avvia);

  // striscia colorata
  $("striscia").addEventListener("click", cliccaStriscia);
  new ResizeObserver(disegnaStriscia).observe($("striscia"));

  // regola la zona a mano
  $("btn-regola").addEventListener("click", apriRegolazione);
  $("anteprima").addEventListener("dblclick", apriRegolazione);
  $("btn-regola-fatto").addEventListener("click", confermaRegolazione);
  $("btn-regola-annulla").addEventListener("click", chiudiRegolazione);
  $("btn-regola-ripristina").addEventListener("click", ripristinaRegolazione);
  $("anteprima-zona").addEventListener("pointerdown", iniziaTrascinamento);
  $("anteprima-zona").addEventListener("pointermove", trascina);
  $("anteprima-zona").addEventListener("pointerup", fineTrascinamento);
  $("anteprima-zona").addEventListener("pointercancel", fineTrascinamento);

  // schermata 3
  $("btn-interrompi").addEventListener("click", interrompi);
  $("btn-dettagli").addEventListener("click", () => {
    const nascosto = $("registro").classList.toggle("nascosto");
    $("btn-dettagli").classList.toggle("aperto", !nascosto);
    $("btn-dettagli").querySelector("span").textContent = nascosto ? "Mostra dettagli" : "Nascondi dettagli";
  });

  // schermata 4
  $("btn-apri").addEventListener("click", apriRisultato);
  $("btn-mostra").addEventListener("click", mostraNellaCartella);
  $("btn-altro").addEventListener("click", () => {
    coda = [];
    indiceAnteprima = 0;
    mostraSchermata("inizio");
  });

  // impostazioni
  $("btn-impostazioni").addEventListener("click", apriImpostazioni);
  $("btn-fine").addEventListener("click", chiudiImpostazioni);
  $("menu-impostazioni").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      mostraSezioneImpostazioni(b.dataset.sezione);
    }
  });
  $("interruttore-aggiornamenti").addEventListener("change", (evento) => {
    scelte.controllaAggiornamenti = evento.target.checked;
    salvaScelte();
  });
  $("btn-controlla").addEventListener("click", () => controllaAggiornamenti(true));
  // mentre sposti la barra il numero cambia subito
  $("cursore-forza").addEventListener("input", (evento) => {
    $("valore-forza").textContent = evento.target.value + " px";
  });
  // forza e margine sono accanto all'anteprima: si vede subito il risultato
  $("cursore-forza").addEventListener("change", (evento) => {
    scelte.forza = Number(evento.target.value);
    salvaScelte();
    aggiornaPannelloTutti();
    caricaAnteprima();
  });
  $("scelta-margine").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (!b) {
      return;
    }
    if (b.dataset.valore === "manuale") {
      scelte.margineManuale = true; // si parte dal margine di adesso
    } else {
      scelte.margineManuale = false;
      scelte.margine = Number(b.dataset.valore);
    }
    aggiornaCopertura();
    salvaScelte();
    caricaAnteprima();
  });
  // margine a mano: il numero cambia subito, l'anteprima quando lasci la barra
  $("cursore-margine").addEventListener("input", (evento) => {
    $("valore-margine").textContent = evento.target.value + "%";
  });
  $("cursore-margine").addEventListener("change", (evento) => {
    scelte.margine = Number(evento.target.value) / 100;
    salvaScelte();
    aggiornaPannelloTutti();
    caricaAnteprima();
  });
  $("scelta-stile").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.stile = b.dataset.valore;
      aggiornaCopertura();
      salvaScelte();
    }
  });

  // parte del video
  $("btn-inizio").addEventListener("click", () => segnaTaglio(true));
  $("btn-fine-taglio").addEventListener("click", () => segnaTaglio(false));
  $("btn-tutto-video").addEventListener("click", togliTaglio);

  // anteprima animata
  $("btn-animazione").addEventListener("click", avviaAnimazione);

  // cartelle
  $("btn-cartella").addEventListener("click", scegliCartella);
  $("btn-scegli-cartella").addEventListener("click", scegliCartella);

  $("scelta-momento").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.momento = b.dataset.valore;
      aggiornaSegmentato("scelta-momento", scelte.momento);
      salvaScelte();
    }
  });
  $("scelta-colore").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.colore = b.dataset.valore;
      aggiornaColori();
      salvaScelte();
    }
  });
  $("btn-scegli-colore").addEventListener("click", apriScegliColore);
  $("scelta-posizione").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.posizione = b.dataset.valore;
      aggiornaSegmentato("scelta-posizione", scelte.posizione);
      salvaScelte();
    }
  });

  // scegli il colore dal video
  $("scegli-img").addEventListener("click", cliccaSulVideo);
  $("cursore-scegli").addEventListener("input", () => {
    clearTimeout(timerScegli);
    timerScegli = setTimeout(caricaFotogrammaScegli, 120);
  });
  $("btn-scegli-annulla").addEventListener("click", () => mostraSchermata("impostazioni"));
  $("btn-scegli-usa").addEventListener("click", usaColoreCliccato);

  // avviso aggiornamento
  $("btn-aggiorna").addEventListener("click", installaAggiornamento);
  $("btn-dopo").addEventListener("click", () => $("avviso").classList.add("nascosto"));

  // scorciatoie da tastiera (l'elenco è in Aiuto › Scorciatoie)
  document.addEventListener("keydown", tastoPremuto);

  // la finestra di domanda
  $("dialogo-si").addEventListener("click", () => chiudiDialogo(true));
  $("dialogo-no").addEventListener("click", () => chiudiDialogo(false));

  // altre cose nuove del pannello e della schermata finale
  $("btn-per-tutti").addEventListener("click", () => {
    scelte.pannelloTutti = !scelte.pannelloTutti;
    salvaScelte();
    aggiornaPannelloTutti();
  });
  $("btn-copia").addEventListener("click", copiaDettagli);
  // aspetto
  $("scelta-tema").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.tema = b.dataset.valore;
      salvaScelte();
      applicaTema();
    }
  });
  $("interruttore-miniature").checked = scelte.miniature;
  $("interruttore-miniature").addEventListener("change", (evento) => {
    scelte.miniature = evento.target.checked;
    salvaScelte();
    disegnaCoda();
  });
  $("interruttore-recenti").checked = scelte.recenti;
  $("interruttore-recenti").addEventListener("change", (evento) => {
    scelte.recenti = evento.target.checked;
    salvaScelte();
    disegnaRecenti();
  });
  $("btn-svuota-recenti").addEventListener("click", () => {
    salvaRecenti([]);
    disegnaRecenti();
  });
  // "Come funziona"
  $("guida-avanti").addEventListener("click", avantiGuida);
  $("guida-salta").addEventListener("click", chiudiGuida);
  $("btn-come-funziona").addEventListener("click", () => {
    chiudiImpostazioni();
    mostraGuida();
  });
  // prima / dopo nella schermata finale
  $("finito-linea").addEventListener("pointerdown", (evento) => {
    trascinaFinito = true;
    $("finito-linea").setPointerCapture(evento.pointerId);
    muoviLineaFinito(evento);
  });
  $("finito-linea").addEventListener("pointermove", muoviLineaFinito);
  $("finito-linea").addEventListener("pointerup", () => (trascinaFinito = false));
  $("finito-linea").addEventListener("pointercancel", () => (trascinaFinito = false));
  // cartella sorvegliata
  $("btn-scegli-sorvegliata").addEventListener("click", scegliSorvegliata);
  // lingua: se non stai lavorando cambia subito, se no al prossimo avvio
  aggiornaSegmentato("scelta-lingua", scelte.lingua);
  $("scelta-lingua").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (!b || b.dataset.valore === scelte.lingua) {
      return;
    }
    scelte.lingua = b.dataset.valore;
    salvaScelte();
    aggiornaSegmentato("scelta-lingua", scelte.lingua);
    if (coda.length === 0 && !alLavoro) {
      location.reload();
    } else {
      $("nota-lingua").classList.remove("nascosto");
    }
  });
  $("btn-togli-sorvegliata").addEventListener("click", togliSorvegliata);
  aggiornaSorvegliata();
  setInterval(controllaSorvegliata, 10000);
  $("btn-schermo").addEventListener("click", cambiaSchermoIntero);
  // tratti da controllare
  $("btn-problema-prima").addEventListener("click", () => vaiAlProblemaVicino(false));
  $("btn-problema-dopo").addEventListener("click", () => vaiAlProblemaVicino(true));
  $("btn-va-bene").addEventListener("click", vaBeneCosi);
  $("btn-copri-tratto").addEventListener("click", () => apriZonaFissa(-1));
  // maniglie del pezzo da salvare
  for (const id of ["maniglia-inizio", "maniglia-fine"]) {
    $(id).addEventListener("pointerdown", iniziaManiglia);
    $(id).addEventListener("pointermove", muoviManiglia);
    $(id).addEventListener("pointerup", fineManiglia);
    $(id).addEventListener("pointercancel", fineManiglia);
  }
  // zone a mano
  $("btn-fissa-nuova").addEventListener("click", () => apriZonaFissa(-1));
  $("scelta-segui").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b && fissaInModifica) {
      cambiaSegui(b.dataset.valore);
    }
  });
  $("interruttore-volti").addEventListener("change", (evento) => {
    scelte.volti = evento.target.checked;
    salvaScelte();
    aggiornaPannelloTutti();
    caricaAnteprima();
  });
  $("btn-fissa-elimina").addEventListener("click", () => eliminaZonaFissa(fissaInModifica.indice));
  for (const b of document.querySelectorAll("#tempi-fissa .passo")) {
    b.addEventListener("click", () => cambiaTempoFissa(b.dataset.quale, Number(b.dataset.passo)));
  }
  // Prima / Dopo: la linea si trascina; con le frecce si sposta; doppio clic = torna sul display
  $("linea-confronto").addEventListener("pointerdown", iniziaLinea);
  $("linea-confronto").addEventListener("pointermove", muoviLinea);
  $("linea-confronto").addEventListener("pointerup", fineLinea);
  $("linea-confronto").addEventListener("pointercancel", fineLinea);
  $("linea-confronto").addEventListener("dblclick", (evento) => {
    evento.stopPropagation(); // non apre "Regola la zona"
    lineaSpostata = false;
    centraLineaSullaZona(ultimaAnteprima ? ultimaAnteprima.zona : null);
  });
  $("linea-confronto").querySelector(".maniglia-confronto").addEventListener("keydown", (evento) => {
    if (evento.key === "ArrowLeft" || evento.key === "ArrowRight") {
      evento.preventDefault();
      evento.stopPropagation();
      divisione += evento.key === "ArrowRight" ? 0.05 : -0.05;
      lineaSpostata = true;
      applicaDivisione();
    }
  });
  applicaDivisione();
  $("btn-torna").addEventListener("click", tornaAiVideo);
  $("scelta-vale").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      valeRegolazione = b.dataset.valore;
      aggiornaSegmentato("scelta-vale", valeRegolazione);
    }
  });

  // chiudere la finestra mentre lavora: prima si chiede
  preparaChiusura();
  // sul Mac: il menu in alto (Velocità, File, Modifica, Video, Finestra, Aiuto)
  creaMenuMac();

  // se l'anteprima cambia grandezza (finestra ridimensionata, avviso che
  // compare o sparisce), la zona tratteggiata va rimessa a posto
  const osservatore = new ResizeObserver(() => {
    if (regolazioneAperta) {
      aggiornaZonaInModifica();
      ingrandisciSullaZona();
    } else if (ultimaAnteprima) {
      posizionaZona($("anteprima-img"), $("anteprima-zona"), ultimaAnteprima.zona);
      disegnaAltreZone();
    }
  });
  osservatore.observe($("anteprima-img"));

  mostraSchermata("inizio");
  aggiornaBarraPixel(0);
  // la prima volta: "Come funziona"
  if (!scelte.guidaVista) {
    setTimeout(mostraGuida, 400);
  }

  if (scelte.controllaAggiornamenti) {
    controllaAggiornamenti(false);
  }
}

avvio();
