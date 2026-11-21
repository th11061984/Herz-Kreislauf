// Lädt und prüft die Fragen-Dateien aus dem Ordner ./fragen
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const FRAGEN_DIR = path.join(__dirname, 'fragen');
const LETTERS = 'ABCDEFGHIJ';

function letterToIndex(value, optionCount, where) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    // Zahlen werden als 1-basiert interpretiert (1 = erste Antwort)
    const idx = value - 1;
    if (idx < 0 || idx >= optionCount) throw new Error(`${where}: "richtig: ${value}" gibt es nicht`);
    return idx;
  }
  const s = String(value).trim().toUpperCase();
  const idx = LETTERS.indexOf(s);
  if (s.length !== 1 || idx < 0 || idx >= optionCount) {
    throw new Error(`${where}: "richtig: ${value}" passt zu keiner Antwort (erlaubt: ${LETTERS.slice(0, optionCount).split('').join(', ')})`);
  }
  return idx;
}

function parseDeck(id, text) {
  const raw = yaml.load(text);
  if (!raw || typeof raw !== 'object') throw new Error(`${id}: Datei ist leer oder kein gültiges YAML`);
  if (!Array.isArray(raw.fragen) || raw.fragen.length === 0) {
    throw new Error(`${id}: "fragen:" fehlt oder ist leer`);
  }
  const questions = raw.fragen.map((q, i) => {
    const where = `${id}, Frage ${i + 1}${q && q.folie != null ? ` (Folie ${q.folie})` : ''}`;
    if (!q || typeof q !== 'object') throw new Error(`${where}: ungültiger Eintrag`);
    if (!q.frage || typeof q.frage !== 'string') throw new Error(`${where}: "frage:" fehlt`);
    if (!Array.isArray(q.antworten) || q.antworten.length < 2) {
      throw new Error(`${where}: mindestens zwei "antworten:" nötig`);
    }
    if (q.antworten.length > LETTERS.length) throw new Error(`${where}: höchstens ${LETTERS.length} Antworten`);
    const options = q.antworten.map((a, j) => {
      if (a == null || String(a).trim() === '') throw new Error(`${where}: Antwort ${LETTERS[j]} ist leer`);
      return String(a);
    });
    if (q.richtig == null) throw new Error(`${where}: "richtig:" fehlt`);
    const richtigList = Array.isArray(q.richtig) ? q.richtig : [q.richtig];
    if (richtigList.length === 0) throw new Error(`${where}: "richtig:" ist leer`);
    const correct = [...new Set(richtigList.map((r) => letterToIndex(r, options.length, where)))].sort((a, b) => a - b);
    return {
      slide: q.folie != null ? String(q.folie) : String(i + 1),
      text: q.frage.trim(),
      options,
      correct,
      multi: correct.length > 1,
      explanation: q.erklaerung ? String(q.erklaerung).trim() : '',
    };
  });
  return { id, title: raw.titel ? String(raw.titel) : id, questions };
}

function listDeckFiles() {
  if (!fs.existsSync(FRAGEN_DIR)) return [];
  return fs
    .readdirSync(FRAGEN_DIR)
    .filter((f) => /\.ya?ml$/i.test(f) && !f.startsWith('_'))
    .sort();
}

// Liefert alle Fragensätze; fehlerhafte Dateien werden mit Fehlermeldung aufgeführt.
function loadAllDecks() {
  return listDeckFiles().map((file) => {
    const id = file.replace(/\.ya?ml$/i, '');
    try {
      return parseDeck(id, fs.readFileSync(path.join(FRAGEN_DIR, file), 'utf8'));
    } catch (err) {
      return { id, title: id, questions: [], error: err.message };
    }
  });
}

function loadDeck(id) {
  const file = listDeckFiles().find((f) => f.replace(/\.ya?ml$/i, '') === id);
  if (!file) throw new Error(`Fragensatz "${id}" nicht gefunden`);
  return parseDeck(id, fs.readFileSync(path.join(FRAGEN_DIR, file), 'utf8'));
}

module.exports = { loadAllDecks, loadDeck, LETTERS, FRAGEN_DIR };
