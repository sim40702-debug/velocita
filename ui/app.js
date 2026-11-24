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

// le scelte dell'utente, salvate per la prossima volta
const scelte = {
  cartella: "",          // "" = accanto al video
  usoCpu: "auto",        // auto, 0.25, 0.5, 0.75, 1
  forza: 10,             // dimensione dei blocchi della pixelatura
  margine: 0.15,         // margine attorno al cruscotto
  momento: "auto",       // auto, giorno, notte
  colore: "arancione",   // arancione, rosso, giallo, verde, blu, bianco, video
  coloreVideo: [255, 140, 26], // il colore preso cliccando sul display (con "video")
  posizione: "basso",    // basso, ovunque: dove cercare il display
  controllaAggiornamenti: true,
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
  // mentre lavora le impostazioni non si aprono
  $("btn-impostazioni").disabled = nome === "corso";
}

// "1 video", "3 video", "2 foto", "4 file"
function testoCoda() {
  const video = coda.filter((f) => !f.foto).length;
  const foto = coda.length - video;
  if (foto === 0) {
    return video + " video";
  }
  if (video === 0) {
    return foto + " foto";
  }
  return coda.length + " file";
}

// codice HTML di un'icona (sono tutte in index.html)
function icona(nome) {
  return '<svg class="icona"><use href="#i-' + nome + '"/></svg>';
}

// una riga della lista dei file: icona, nome, testo piccolo sotto
function creaRigaFile(tag, file, meta) {
  const riga = document.createElement(tag);
  riga.className = "riga-file";
  riga.innerHTML = icona(file.foto ? "foto" : "video") + '<span class="testi"><span class="nome"></span><span class="meta"></span></span>';
  riga.querySelector(".nome").textContent = file.nome;
  riga.querySelector(".meta").textContent = meta;
  return riga;
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
  if (risposta.zona) {
    const momento = risposta.momento === "giorno" ? "Giorno" : "Notte";
    testo = momento + " · " + NOMI_COLORI[scelte.colore];
    if (scelte.posizione === "ovunque") {
      testo = testo + " · Ovunque";
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
  // tiene solo i file con un'estensione giusta
  const validi = percorsi.filter((p) => {
    const estensione = p.split(".").pop().toLowerCase();
    return ESTENSIONI.includes(estensione);
  });
  if (validi.length === 0) {
    mostraErrore("Questo tipo di file non si può usare", "Scegli un video (MP4, MOV, MKV, AVI) o una foto (JPG, PNG, WEBP).");
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
        mostraErrore("Non riesco ad aprire il file", String(errore));
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

  // durata totale dei video, sopra il bottone Avvia
  let durata = 0;
  for (const f of coda) {
    if (!f.foto) {
      durata += f.durata;
    }
  }
  let riepilogo = testoCoda();
  if (durata > 0) {
    riepilogo += " · " + formattaTempo(durata) + (coda.length > 1 ? " in tutto" : "");
  }
  $("testo-riepilogo").textContent = riepilogo;
  $("barra-sottotitolo").textContent = testoCoda();

  $("testo-zona").textContent = primo.regolazione ? "Regolata a mano" : "Automatica";
  disegnaStriscia();

  $("nome-cartella").textContent = scelte.cartella ? nomeDaPercorso(scelte.cartella) : "Accanto al video";
  $("btn-reset-cartella").classList.toggle("nascosto", !scelte.cartella);
  $("btn-avvia").textContent = coda.length > 1 ? "Avvia (" + coda.length + " file)" : "Avvia";
  $("btn-apri").textContent = tuttiFoto ? "Apri foto" : "Apri video";

  // con una foto il cursore dell'anteprima non serve
  $("cursore-anteprima").classList.toggle("nascosto", primo.foto);
}

function disegnaCoda() {
  const lista = $("lista-coda");
  lista.innerHTML = "";
  coda.forEach((file, i) => {
    const riga = creaRigaFile("button", file, file.foto ? "Foto" : formattaTempo(file.durata));
    if (i === indiceAnteprima) {
      riga.classList.add("attivo");
    }

    const togli = document.createElement("span");
    togli.className = "bottone-icona piccolo";
    togli.innerHTML = icona("x");
    togli.title = "Togli dalla coda";
    togli.addEventListener("click", (evento) => {
      evento.stopPropagation();
      togliDallaCoda(i);
    });
    riga.appendChild(togli);

    // clic su un file = lo mostra nell'anteprima
    riga.addEventListener("click", () => {
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
    });
    if (mioNumero !== numeroAnteprima) {
      return; // nel frattempo è stata chiesta un'altra anteprima
    }
    ultimaAnteprima = risposta;
    const img = $("anteprima-img");
    img.onload = () => posizionaZona(img, $("anteprima-zona"), risposta.zona);
    img.src = risposta.immagine;
    mostraInfoAnteprima(risposta);

    if (risposta.zona) {
      $("anteprima-carico").classList.add("nascosto");
      $("testo-anteprima").textContent = file.foto
        ? "La zona tratteggiata è quella che verrà coperta."
        : "La zona tratteggiata è quella che verrà coperta. Sposta il cursore per controllare.";
    } else {
      $("anteprima-carico").textContent = "Qui non trovo il display.";
      $("testo-anteprima").textContent = file.foto
        ? "In questa foto il numero non verrebbe coperto."
        : "Prova a spostare il cursore su un altro punto del video.";
    }
  } catch (errore) {
    if (mioNumero === numeroAnteprima) {
      $("anteprima-info").classList.add("nascosto");
      $("anteprima-carico").textContent = "Anteprima non disponibile: " + errore;
    }
  }
}

// ==========================================
// 3. ELABORAZIONE
// ==========================================

let fileInCorso = 0;

async function avvia() {
  if (alLavoro || coda.length === 0) {
    return;
  }
  alLavoro = true;
  ultimiRisultati = [];
  $("registro").textContent = "";
  mostraSchermata("corso");

  const inizioTotale = Date.now();
  let interrotto = false;

  for (let i = 0; i < coda.length; i++) {
    fileInCorso = i;
    const file = coda[i];
    preparaSchermataCorso(file, i);
    scriviRegistro("Inizio: " + file.nome);

    try {
      const risultato = await invoke("elabora", {
        percorso: file.percorso,
        cartella: scelte.cartella || null,
        usoCpu: valoreUsoCpu(),
        forza: Number(scelte.forza),
        margine: Number(scelte.margine),
        debug: $("interruttore-prova").checked,
        display: sceltaDisplay(file),
      });

      if (risultato.interrotto) {
        scriviRegistro("Interrotto dall'utente.");
        interrotto = true;
        break;
      }
      ultimiRisultati.push({ nome: file.nome, foto: file.foto, uscita: risultato.uscita, trovato: risultato.trovato, errore: null, secondi: risultato.secondi });
      scriviRegistro("Salvato: " + risultato.uscita + " (" + formattaTempo(risultato.secondi) + ")");
      if (!risultato.trovato) {
        scriviRegistro("Attenzione: display mai trovato in " + file.nome);
      }
    } catch (errore) {
      ultimiRisultati.push({ nome: file.nome, foto: file.foto, uscita: null, trovato: false, errore: String(errore) });
      scriviRegistro("Errore con " + file.nome + ": " + errore);
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
        meta = r && r.secondi ? "Fatto in " + formattaTempo(r.secondi) : "Fatto";
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
  $("barra-piena").style.width = "0%";
  $("corso-fotogrammi").textContent = "Avvio…";
  $("corso-mancano").textContent = "";
  $("corso-sottotitolo").textContent =
    coda.length > 1 ? "File " + (indice + 1) + " di " + coda.length : "Sto lavorando…";
  $("btn-interrompi").disabled = false;
  $("btn-interrompi").textContent = "Interrompi";

  // immagine del file in lavorazione (quella dell'anteprima, se è lo stesso)
  const img = $("corso-img");
  if (indice === indiceAnteprima && ultimaAnteprima) {
    img.onload = () => posizionaZona(img, $("corso-zona"), ultimaAnteprima.zona);
    img.src = ultimaAnteprima.immagine;
  } else {
    $("corso-zona").classList.add("nascosto");
    invoke("anteprima", {
      percorso: file.percorso,
      posizione: 0.3,
      forza: Number(scelte.forza),
      margine: Number(scelte.margine),
      display: sceltaDisplay(file),
    })
      .then((r) => {
        if (fileInCorso !== indice) {
          return;
        }
        img.onload = () => posizionaZona(img, $("corso-zona"), r.zona);
        img.src = r.immagine;
      })
      .catch(() => {});
  }
}

// arriva da Rust mentre lavora
tauri.event.listen("avanzamento", (evento) => {
  const a = evento.payload;
  const percentuale = a.totali > 0 ? Math.min(100, Math.floor((a.fatti / a.totali) * 100)) : 0;
  $("barra-piena").style.width = percentuale + "%";
  $("corso-percentuale").textContent = percentuale + "%";
  $("corso-fotogrammi").textContent = "Fotogramma " + formattaNumero(a.fatti) + " di " + formattaNumero(a.totali);
  // la riga del file in corso, a destra
  if ($("riga-percentuale")) {
    $("riga-percentuale").textContent = percentuale + "%";
    $("riga-barra").style.width = percentuale + "%";
    $("riga-fotogrammi").textContent = formattaNumero(a.fatti) + " di " + formattaNumero(a.totali) + " fotogrammi";
  }
  if (a.fatti > 30 && a.fatti < a.totali) {
    $("corso-mancano").textContent = "Mancano circa " + formattaTempo(a.secondi_mancanti);
  } else if (a.fatti >= a.totali) {
    $("corso-mancano").textContent = "Salvo il video…";
  }
});

async function interrompi() {
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
  const iconaEsito = $("esito-icona");

  if (riusciti.length === 0) {
    iconaEsito.className = "esito-icona errore";
    iconaEsito.innerHTML = icona("attenzione");
    $("esito-titolo").textContent = "Non è andata";
    $("esito-testo").textContent = sbagliati.length > 0 ? sbagliati[0].errore : "Nessun file è stato creato.";
  } else if (nonTrovati.length > 0 || sbagliati.length > 0) {
    iconaEsito.className = "esito-icona attenzione";
    iconaEsito.innerHTML = icona("attenzione");
    $("esito-titolo").textContent = "Fatto, ma controlla";
    const pezzi = [];
    if (nonTrovati.length > 0) {
      pezzi.push("In " + nonTrovati.map((r) => r.nome).join(", ") + " non ho trovato il display.");
    }
    if (sbagliati.length > 0) {
      if (sbagliati.length === 1) {
        pezzi.push("1 file non è stato elaborato (il motivo è qui sotto).");
      } else {
        pezzi.push(sbagliati.length + " file non sono stati elaborati (il motivo è qui sotto).");
      }
    }
    $("esito-testo").textContent = pezzi.join(" ");
  } else {
    iconaEsito.className = "esito-icona ok";
    iconaEsito.innerHTML = icona("spunta");
    $("esito-titolo").textContent = "Fatto";
    if (riusciti.length === 1) {
      const dove = scelte.cartella ? "nella cartella scelta." : "accanto all'originale.";
      $("esito-testo").textContent = nomeDaPercorso(riusciti[0].uscita) + " è " + dove;
    } else {
      $("esito-testo").textContent = riusciti.length + " file pronti.";
    }
  }
  $("esito-tempo").textContent = "Tempo impiegato: " + formattaTempo(secondi);

  $("btn-apri").classList.toggle("nascosto", riusciti.length !== 1);
  $("btn-mostra").classList.toggle("nascosto", riusciti.length === 0);
  disegnaRisultati();
  mostraImmagineFinito($("corso-img").getAttribute("src"));
  mostraSchermata("finito");
}

// elenco a destra: un file per riga, con un clic si apre
function disegnaRisultati() {
  const lista = $("lista-risultati");
  lista.innerHTML = "";
  if (ultimiRisultati.length < 2) {
    return; // con un solo file basta il testo sopra
  }
  for (const r of ultimiRisultati) {
    let meta = "Coperto";
    let stato = '<span class="segno ok">' + icona("spunta") + "</span>";
    if (r.errore) {
      meta = r.errore;
      stato = '<span class="segno errore">' + icona("x") + "</span>";
    } else if (!r.trovato) {
      meta = "Display non trovato: controlla";
      stato = '<span class="segno attenzione">' + icona("attenzione") + "</span>";
    }
    const nome = r.uscita ? nomeDaPercorso(r.uscita) : r.nome;
    const riga = creaRigaFile(r.uscita ? "button" : "div", { nome: nome, foto: r.foto }, meta);
    riga.title = r.errore || "";
    riga.insertAdjacentHTML("beforeend", stato);
    if (r.uscita) {
      riga.title = "Apri";
      riga.addEventListener("click", () => tauri.opener.openPath(r.uscita));
    }
    lista.appendChild(riga);
  }
}

// a sinistra nella schermata finale: l'ultimo fotogramma visto
function mostraImmagineFinito(src) {
  if (src) {
    $("finito-img").src = src;
    $("finito-img").classList.remove("nascosto");
  } else {
    $("finito-img").classList.add("nascosto");
  }
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

function mostraErrore(titolo, testo) {
  ultimiRisultati = [];
  const iconaEsito = $("esito-icona");
  iconaEsito.className = "esito-icona errore";
  iconaEsito.innerHTML = icona("attenzione");
  $("esito-titolo").textContent = titolo;
  $("esito-testo").textContent = testo;
  $("esito-tempo").textContent = "";
  $("btn-apri").classList.add("nascosto");
  $("btn-mostra").classList.add("nascosto");
  disegnaRisultati();
  mostraImmagineFinito(ultimaAnteprima ? ultimaAnteprima.immagine : "");
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
      $("avviso-titolo").textContent = "È disponibile la versione " + aggiornamento.version;
      // prima riga delle note della release
      const note = (aggiornamento.body || "").split("\n").find((r) => r.trim() !== "") || "";
      $("avviso-note").textContent = note.replace(/^[#*\-\s]+/, "");
      $("avviso").classList.remove("nascosto");
      if (manuale) {
        $("btn-controlla").textContent = "Disponibile la " + aggiornamento.version;
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
    $("avviso-note").textContent = "Aggiornamento non riuscito: " + errore;
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
const COLORI_STRISCIA = ["--rosso", "--ambra", "--verde"];
// il video che si sta analizzando adesso ("" = nessuno)
let analisiInCorso = "";

// fa partire l'analisi del file mostrato, se non c'è già
function analizzaSeServe() {
  const file = coda[indiceAnteprima];
  if (!file || file.foto) {
    return;
  }
  const giaFatta = file.copertura && file.copertura.finito;
  if (giaFatta || analisiInCorso === file.percorso) {
    return;
  }
  analisiInCorso = file.percorso;
  file.copertura = { stati: [], totali: 1, finito: false };
  disegnaStriscia();
  invoke("analizza", { percorso: file.percorso, display: sceltaDisplay(file) })
    .catch((errore) => {
      file.copertura = { stati: [], totali: 1, finito: true, errore: String(errore) };
      disegnaStriscia();
    })
    .finally(() => {
      if (analisiInCorso === file.percorso) {
        analisiInCorso = "";
      }
    });
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

// "1 tratto", "3 tratti"
function testoTratti(numero) {
  return numero === 1 ? "1 tratto" : numero + " tratti";
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
    $("legenda").innerHTML = "";
    return;
  }
  const passo = larghezza / Math.max(c.totali, c.stati.length);
  c.stati.forEach((stato, i) => {
    ctx.fillStyle = coloreCss(COLORI_STRISCIA[stato]);
    ctx.fillRect(i * passo, 0, passo + 0.5, altezza);
  });

  // la scritta sotto
  const legenda = $("legenda");
  if (c.errore) {
    legenda.textContent = "Analisi non riuscita: " + c.errore;
    return;
  }
  if (!c.finito) {
    const percentuale = Math.floor((c.stati.length / Math.max(1, c.totali)) * 100);
    legenda.textContent = "Analisi del video… " + percentuale + "%";
    return;
  }
  const incerti = contaTratti(c.stati, 1);
  const mancanti = contaTratti(c.stati, 0);
  const pezzi = [];
  if (incerti === 0 && mancanti === 0) {
    pezzi.push('<span><i style="background:var(--verde)"></i>Display trovato in tutto il video</span>');
  } else {
    pezzi.push('<span><i style="background:var(--verde)"></i>Coperto</span>');
    if (incerti > 0) {
      pezzi.push('<span><i style="background:var(--ambra)"></i>Da controllare · ' + testoTratti(incerti) + "</span>");
    }
    if (mancanti > 0) {
      pezzi.push('<span><i style="background:var(--rosso)"></i>Non trovato · ' + testoTratti(mancanti) + "</span>");
    }
    pezzi.push("<span>Clicca sulla striscia per andarci</span>");
  }
  legenda.innerHTML = pezzi.join("");
}

// clic sulla striscia: l'anteprima va in quel punto del video
function cliccaStriscia(evento) {
  const box = $("striscia").getBoundingClientRect();
  const posizione = Math.min(1, Math.max(0, (evento.clientX - box.left) / box.width));
  $("cursore-anteprima").value = Math.round(posizione * 1000);
  caricaAnteprima();
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

function apriRegolazione() {
  if (regolazioneAperta) {
    return;
  }
  if (!ultimaAnteprima || !ultimaAnteprima.zona_base) {
    $("testo-anteprima").textContent =
      "Qui il display non viene trovato: sposta il cursore su un punto verde della striscia, poi premi «Regola…».";
    return;
  }
  regolazioneAperta = true;
  zonaInModifica = Object.assign({}, ultimaAnteprima.zona);
  $("schermata-pronto").classList.add("regolazione-aperta");
  $("barra-regola").classList.remove("nascosto");
  aggiornaZonaInModifica();
  ingrandisciSullaZona();
}

function chiudiRegolazione() {
  regolazioneAperta = false;
  trascinamento = null;
  $("schermata-pronto").classList.remove("regolazione-aperta");
  $("barra-regola").classList.add("nascosto");
  scalaTela = 1;
  $("anteprima-tela").style.transform = "";
  $("anteprima-tela").style.setProperty("--scala", 1);
  if (ultimaAnteprima) {
    posizionaZona($("anteprima-img"), $("anteprima-zona"), ultimaAnteprima.zona);
  }
}

// "Fatto": salva lo spostamento e la grandezza rispetto alla zona automatica
function confermaRegolazione() {
  const file = coda[indiceAnteprima];
  const base = ultimaAnteprima.zona_base;
  const z = zonaInModifica;
  file.regolazione = {
    dx: (z.x + z.w / 2 - (base.x + base.w / 2)) / base.w,
    dy: (z.y + z.h / 2 - (base.y + base.h / 2)) / base.h,
    larghezza: z.w / base.w,
    altezza: z.h / base.h,
  };
  chiudiRegolazione();
  aggiornaSchedaFile();
  caricaAnteprima();
}

// "Ripristina": torna alla zona automatica
function ripristinaRegolazione() {
  coda[indiceAnteprima].regolazione = null;
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
    $("scegli-fumetto").textContent = "Anteprima non disponibile: " + errore;
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
// AVVIO: collega i bottoni
// ==========================================

async function avvio() {
  caricaScelte();

  // mette i valori salvati nei controlli
  aggiornaSegmentato("scelta-cpu", scelte.usoCpu);
  aggiornaSegmentato("scelta-margine", scelte.margine);
  aggiornaSegmentato("scelta-momento", scelte.momento);
  aggiornaSegmentato("scelta-posizione", scelte.posizione);
  aggiornaColori();
  $("cursore-forza").value = scelte.forza;
  $("valore-forza").textContent = scelte.forza + " px";
  $("interruttore-aggiornamenti").checked = scelte.controllaAggiornamenti;

  // versione dell'app
  const versione = await tauri.app.getVersion();
  $("testo-versione").textContent = "Versione " + versione;

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
    caricaAnteprima();
  });
  $("scelta-margine").addEventListener("click", (evento) => {
    const b = evento.target.closest("button");
    if (b) {
      scelte.margine = Number(b.dataset.valore);
      aggiornaSegmentato("scelta-margine", scelte.margine);
      salvaScelte();
      caricaAnteprima();
    }
  });

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

  // scorciatoie da tastiera: ⌘O apri, ⌘, impostazioni, Esc chiude
  document.addEventListener("keydown", (evento) => {
    const comando = evento.metaKey || evento.ctrlKey;
    if (comando && evento.key.toLowerCase() === "o" && !alLavoro) {
      evento.preventDefault();
      scegliFile();
    } else if (comando && evento.key === ",") {
      evento.preventDefault();
      apriImpostazioni();
    } else if (evento.key === "Escape" && regolazioneAperta) {
      chiudiRegolazione();
    } else if (evento.key === "Enter" && regolazioneAperta) {
      confermaRegolazione();
    } else if (evento.key === "Escape") {
      if (!$("schermata-impostazioni").classList.contains("nascosto")) {
        chiudiImpostazioni();
      } else if (!$("schermata-scegli").classList.contains("nascosto")) {
        mostraSchermata("impostazioni");
      }
    }
  });

  // se l'anteprima cambia grandezza (finestra ridimensionata, avviso che
  // compare o sparisce), la zona tratteggiata va rimessa a posto
  const osservatore = new ResizeObserver(() => {
    if (regolazioneAperta) {
      aggiornaZonaInModifica();
      ingrandisciSullaZona();
    } else if (ultimaAnteprima) {
      posizionaZona($("anteprima-img"), $("anteprima-zona"), ultimaAnteprima.zona);
    }
  });
  osservatore.observe($("anteprima-img"));

  mostraSchermata("inizio");

  if (scelte.controllaAggiornamenti) {
    controllaAggiornamenti(false);
  }
}

avvio();
