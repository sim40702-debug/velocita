// Motore di Velocità: trova il display della moto e pixela il numero.
// È lo stesso metodo della versione Python (SpeedDisplayProcessor),
// riscritto in Rust senza OpenCV.

pub mod rilevamento;
pub mod video;

pub use rilevamento::{ColoreDisplay, Fotogramma, Impostazioni, Inseguitore, Momento, Riquadro};
