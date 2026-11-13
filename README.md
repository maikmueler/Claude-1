# 👗 Kleiderschrank – Outfit-Planer

Eine Web-App (PWA) fürs Handy: Kleidung abfotografieren, jeden Tag einen Outfit-Vorschlag passend zum Wetter bekommen und Reisen mit Outfits pro Tag und Packliste planen.

## Funktionen

- **📸 Kleidung scannen** – Foto aufnehmen oder mehrere Bilder aus der Galerie wählen. Die Hauptfarbe wird automatisch erkannt (Hintergrund wird herausgefiltert). Kategorie, Wärme, Anlässe, „wasserfest“ und Favorit lassen sich festlegen.
- **✨ Outfit des Tages** – holt das Wetter für deinen Standort (Open-Meteo, ohne API-Schlüssel) und kombiniert Oberteil/Hose oder Kleid, bei Kälte Pulli und Jacke, dazu Schuhe. Bewertet werden:
  - Wärme passend zur Temperatur, regenfeste Jacke bei Regen
  - gewählter Anlass (Alltag, Büro, Sport, Ausgehen, Elegant, Strand, Outdoor)
  - Farbharmonie (Neutrale + max. eine Akzentfarbe, Komplementär-/Nachbarfarben, nicht zwei Muster)
  - Abwechslung: kürzlich Getragenes wird vermieden
  - „🔄 Anderes“ für einen neuen Vorschlag, ein einzelnes Teil antippen zum Tauschen, „✓ Ziehe ich an“ speichert den Verlauf.
- **🧳 Reiseplanung** – Ziel, Datum und Aktivitäten eingeben. Die App nutzt die 16-Tage-Vorhersage bzw. für spätere Reisen die Wetterwerte vom gleichen Zeitraum im Vorjahr, plant ein Outfit pro Tag und hält den Koffer klein, indem Teile sinnvoll wiederverwendet werden. Dazu eine abhakbare Packliste (inkl. Unterwäsche, Regenschirm, Badesachen …).
- **🧺 Wäschemodus** – Teile in der Wäsche werden nicht vorgeschlagen.
- **📊 Statistik** – meistgetragene und nie getragene Teile.
- **🔒 Privat & offline** – alle Fotos und Daten bleiben in IndexedDB auf dem Gerät; Sicherung per JSON-Export/-Import.

## Starten

Kein Build-Schritt nötig – es sind reine HTML/CSS/JS-Dateien.

```bash
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```

Für Kamera, Standort und Installation auf dem Handy muss die App über **HTTPS** laufen, z. B. über **GitHub Pages**:
Repository → *Settings* → *Pages* → *Deploy from a branch* → Branch wählen → *Save*.
Danach die Seite auf dem Handy öffnen und „Zum Home-Bildschirm“ (iPhone/Safari) bzw. „App installieren“ (Android/Chrome) wählen.

## Aufbau

| Datei | Inhalt |
|---|---|
| `index.html`, `css/styles.css` | Oberfläche (Hell/Dunkel-Modus) |
| `js/app.js` | Ansichten: Heute, Schrank, Reisen, Mehr |
| `js/outfit.js` | Kombinations- und Bewertungslogik, Reiseplanung |
| `js/color.js` | Foto verkleinern, Farberkennung |
| `js/weather.js` | Wetter, Ortssuche, Vorjahreswerte (Open-Meteo) |
| `js/db.js` | lokale Speicherung (IndexedDB) |
| `sw.js`, `manifest.webmanifest` | Offline-Fähigkeit und Installation |

## Ideen für später

- Erkennung der Kategorie per KI-Bildanalyse
- Freisteller (Hintergrund entfernen)
- Kalender-Anbindung für Termine (z. B. „Meeting“ → Büro-Outfit)
- Synchronisierung zwischen Geräten
