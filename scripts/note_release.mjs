// Prepara il testo della release su GitHub.
// Uso: node scripts/note_release.mjs v0.3.7
//
// - Se c'è note-release/v0.3.7.md usa quel file. Le immagini scritte come
//   (immagini/foto.png) diventano un indirizzo completo, perché nella
//   pagina della release i percorsi corti non funzionano.
// - Se il file non c'è, scrive l'elenco dei commit dalla versione prima.

import fs from "node:fs";
import { execSync } from "node:child_process";

const tag = process.argv[2];
if (!tag) {
  console.error("Manca la versione, es.: node scripts/note_release.mjs v0.3.7");
  process.exit(1);
}

// es. "sim40702-debug/velocita" (su GitHub Actions arriva da solo)
const repo = process.env.GITHUB_REPOSITORY || "sim40702-debug/velocita";
const indirizzoImmagini = "https://raw.githubusercontent.com/" + repo + "/main/note-release/immagini/";

const file = "note-release/" + tag + ".md";
let testo;

if (fs.existsSync(file)) {
  testo = fs.readFileSync(file, "utf8");
  testo = testo.replaceAll("](immagini/", "](" + indirizzoImmagini);
} else {
  // niente note scritte: l'elenco dei commit dalla versione prima
  let prima = "";
  try {
    prima = execSync("git describe --tags --abbrev=0 " + tag + "^", { encoding: "utf8" }).trim();
  } catch (e) {
    // è la prima versione: tutti i commit
  }
  const da = prima ? prima + ".." + tag : tag;
  testo = execSync('git log --no-merges --format="- %s" ' + da, { encoding: "utf8" });
}

console.log(testo.trim());
