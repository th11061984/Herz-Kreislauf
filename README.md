# Live-Quiz für die Vorlesung

Studierende scannen einen QR-Code, geben ihren Namen ein und beantworten live Multiple-Choice-Fragen.
Die Dozentin steuert vorne über die Admin-Ansicht, wann eine Frage erscheint und wann die Lösung aufgedeckt wird.

**Es wird nichts dauerhaft gespeichert.** Namen und Antworten liegen nur im Arbeitsspeicher des Servers und
verschwinden bei einem Neustart. Es gibt keine Konten: Der Admin-Bereich wird nur mit der freigeschalteten E-Mail-Adresse geöffnet (`ADMIN_EMAIL` in `fly.toml`).

## Ablauf in der Vorlesung

1. `https://<ihre-app>.fly.dev/admin` öffnen, mit der E-Mail-Adresse anmelden, Fragensatz wählen.
2. Der Beamer zeigt einen großen QR-Code; die Namen der Angemeldeten erscheinen live.
3. **Start**: die erste Frage erscheint auf allen Handys. Vorne sieht man „x von y haben geantwortet“.
4. **Auflösen**: die richtige Antwort wird vorne und auf den Handys grün markiert, inklusive Verteilung der Antworten
   und optionaler Erklärung. Jede Person sieht, ob sie richtig lag.
5. **Nächste Frage** und so weiter. Am Ende kann eine Ergebnisliste eingeblendet werden (nur im Speicher).

Steuerung per Tastatur oder Präsentations-Clicker: `→` / `Leertaste` / `Bild ↓` = weiter, `←` / `Bild ↑` = zurück,
`F` = Vollbild, `L` = Lösung vorab nur gestrichelt markieren. Über „Springe zu …“ kann man direkt zu einer Folie springen.
Wer zu spät kommt, scannt den kleinen QR-Code unten rechts und steigt bei der aktuellen Frage ein.

## Fragen gemeinsam erstellen

Jeder Fragensatz ist eine YAML-Datei im Ordner [`fragen/`](fragen/), z. B. eine Datei pro Vorlesung.
Die Vorlage mit allen Möglichkeiten ist [`fragen/_vorlage.yaml`](fragen/_vorlage.yaml):

```yaml
titel: Herz-Kreislauf – Teil 1
fragen:
  - folie: 4
    frage: Welche Herzklappe liegt zwischen linkem Vorhof und linker Kammer?
    antworten:
      - Trikuspidalklappe
      - Mitralklappe
      - Pulmonalklappe
    richtig: B
    erklaerung: Optionaler Text, der nach dem Auflösen erscheint.
```

- `richtig: [A, C]` → mehrere richtige Antworten (die Teilnehmenden dürfen dann mehrere wählen).
- Dateien, die mit `_` beginnen, werden ignoriert.
- Dateien werden alphabetisch sortiert (`01-…`, `02-…`).
- Prüfen: `npm run check`. Das passiert auch automatisch bei jedem Push (GitHub Actions) und beim Docker-Build,
  ein Tippfehler kann also nie live gehen.

Bearbeiten geht direkt auf GitHub (Datei öffnen → Stift-Symbol), per Pull Request oder lokal.

## Lokal starten

```bash
npm install
```

```bash
ADMIN_EMAIL=test@example.com npm run dev
```

Teilnehmen: http://localhost:3000, Admin: http://localhost:3000/admin.
Zum Testen mit dem Handy im selben WLAN die IP des Rechners statt `localhost` verwenden.

## Deployment auf Fly.io

Einmalig (mit installiertem [`flyctl`](https://fly.io/docs/flyctl/install/)):

```bash
fly auth login
```

```bash
fly launch --no-deploy --copy-config --name herz-kreislauf-quiz --region fra
```

```bash
fly deploy --ha=false
```

Wichtig: Der Zustand liegt im Speicher, daher muss **genau eine Maschine** laufen (`--ha=false`, ggf. `fly scale count 1`).
Die Maschine legt sich schlafen, wenn niemand verbunden ist, und startet beim ersten Aufruf in wenigen Sekunden.
Wer eine eigene Domain nutzt, kann `PUBLIC_URL` setzen; sonst wird die Adresse für den QR-Code automatisch erkannt.

### Automatisch deployen über GitHub

```bash
fly tokens create org -x 999999h
```

Den Token in GitHub unter *Settings → Secrets and variables → Actions* als `FLY_API_TOKEN_HERZ` hinterlegen.
Ab dann wird jeder Push auf den Standard-Branch geprüft und deployt; die App wird beim ersten Mal automatisch angelegt. Manuell starten: Tab *Actions* → „Prüfen & Deployen“ → *Run workflow*.

## Technik

- Node.js + Express + Socket.IO, keine Datenbank, kein Build-Schritt
- `server.js`: Live-Session (Phasen: Lobby → Frage → Auflösung → … → Ende)
- `decks.js`: Laden und Prüfen der Fragen-Dateien
- `public/`: Teilnehmerseite (`index.html`), Admin-/Beamer-Ansicht (`admin.html`)
- Gestaltung angelehnt an margit-allmeroth.de (Lato, Orange `#ffad31`, Pflaume `#7a3561`); die Schrift wird lokal ausgeliefert
