// Prüft alle Dateien in ./fragen – aufrufen mit: npm run check
const { loadAllDecks } = require('../decks');

const decks = loadAllDecks();
let failed = false;
if (decks.length === 0) {
  console.log('Keine Fragen-Dateien in ./fragen gefunden.');
}
for (const d of decks) {
  if (d.error) {
    failed = true;
    console.error(`✗ ${d.error}`);
  } else {
    console.log(`✓ ${d.id}: "${d.title}" – ${d.questions.length} Fragen`);
  }
}
process.exit(failed ? 1 : 0);
