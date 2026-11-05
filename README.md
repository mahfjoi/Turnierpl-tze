# ⚽ KICKOFF – Turnierplaner

Kleine Web-App, um Fußballturniere auf der Konsole (FIFA / EA FC & Co.) mit Freunden zu organisieren – gemacht fürs Smartphone.

## Funktionen

- **Neues Turnier:** Name, Spieler eintragen (zuletzt verwendete Namen per Fingertipp)
- **Modus**
  - *Jeder gegen jeden* – optional mit anschließender K.-o.-Runde (Top 2/4/8)
  - *Gruppen* (2–4 Gruppen, zufällig ausgelost, „Neu auslosen“ möglich)
- **Rückspiel** an/aus (Hin- und Rückrunde)
- **Nach der Gruppenphase**
  - *Platz gegen Platz*: 1. gegen 1. = Finale, 2. gegen 2. = Spiel um Platz 3 … (bei 3–4 Gruppen spielen die Gleichplatzierten eine Mini-Runde)
  - *K.-o.-Runde*: Viertelfinale / Halbfinale / Finale + Spiel um Platz 3, bei Gleichstand wird der Elfmeter-Sieger gewählt
- **Live-Ansicht:** zeigt, wer jetzt dran ist und wer danach spielt; Ergebnis mit +/− eingeben
- **Tabellen** mit Form-Kurve, **alle Spiele** mit Ergebnissen (nachträglich änderbar), Statistik, Siegerehrung mit Podest
- Funktioniert **offline** und lässt sich wie eine App auf den Startbildschirm legen
- Daten werden **nur lokal auf dem Gerät** gespeichert (kein Konto, kein Server)

Tabellen-Reihenfolge: Punkte → Tordifferenz → geschossene Tore → direkter Vergleich.

## Online stellen (GitHub Pages)

1. Auf GitHub im Repository: **Settings → Pages**
2. Unter *Build and deployment*: Source **Deploy from a branch**, Branch **main**, Ordner **/ (root)** → **Save**
3. Nach 1–2 Minuten ist die App erreichbar unter
   `https://mahfjoi.github.io/Turnierpl-tze/`

> Hinweis: GitHub Pages ist für **öffentliche** Repositories kostenlos. Für private Repositories braucht man GitHub Pro.

## Aufs Handy holen

- **iPhone (Safari):** Link öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**
- **Android (Chrome):** Link öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“

## Technik

Reines HTML/CSS/JavaScript ohne Build-Schritt (`index.html`, `styles.css`, `app.js`), Service Worker (`sw.js`) für Offline-Betrieb.
Lokal testen: `python3 -m http.server` im Projektordner und `http://localhost:8000` öffnen.
Nach Änderungen an der App die Cache-Version in `sw.js` erhöhen, damit Handys die neue Version laden.
