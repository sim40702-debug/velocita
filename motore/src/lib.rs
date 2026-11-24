// Motore di Velocità: trova il display arancione e pixela il numero.
// È lo stesso metodo della versione Python (SpeedDisplayProcessor),
// riscritto in Rust senza OpenCV.

pub mod rilevamento;
pub mod video;

pub use rilevamento::{Fotogramma, Impostazioni, Inseguitore, Riquadro};
