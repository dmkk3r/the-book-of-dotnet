# The Book of .NET: Anweisungen für Claude Code

Statische, interaktive Lernplattform zu den Interna der .NET-Runtime (deutschsprachig). Kapitel und Lektionen mit Schritt-für-Schritt-Visualisierungen (Stack, Heap, JIT, Threads). Astro, gehostet auf GitHub Pages, kein Backend.

## Arbeitsweise
- Vor dem Abschluss immer: `npm run check && npm run test && npm run build`.
- Wenn eine Entscheidung unklar oder offensichtlich falsch ist: nachfragen statt raten.
- Referenzlektion für Tiefe, Ton und Aufbau: `src/content/lessons/typsystem/boxing.mdx` mit ihren `.steps.ts`-Dateien.

## Sprache
- UI-Texte und Lektionsinhalte: Deutsch, Sie-freie Du-Ansprache, typografische Anführungszeichen („ “).
- Keine Gedankenstriche (– oder —) und keine Mittelpunkte (·) als Trenner, weder in Texten noch in der Oberfläche. Stattdessen Komma, Doppelpunkt, Klammern, eigene Sätze oder Abstand. Leere Werte als Wort („leer“, „keine“), nicht als Strich.
- Code, Bezeichner, Commit-Messages, Dateinamen: Englisch.

## Inhaltliche Korrektheit (wichtigste Regel)
Diese Plattform vermittelt mentale Modelle. Ein falsches Modell, schön animiert, ist schlimmer als keines.
- Neue Lektionen bekommen immer `status: draft`. Nur der Autor setzt `reviewed` oder `verified`.
- Konkrete Zahlen (Objektgrößen, Allokationen, IL-Instruktionen, Assembler) nur übernehmen, wenn sie aus SharpLab, BenchmarkDotNet oder dem dotnet/runtime-Quellcode stammen. Sonst als `TODO(verify): …` markieren (MDX: `{/* TODO(verify): … */}`, TS: `// TODO(verify): …`).
- Jede Lektion listet ihre Quellen in `sources` (Book of the Runtime, Blogposts des .NET-Teams, Quellcode-Links).
- Versionsabhängiges Verhalten mit der .NET-Version kennzeichnen (`dotnetVersion` im Frontmatter oder Hinweis im Text).

## Aufbau einer Lektion
- Dateien: `src/content/lessons/<chapterId>/<lessonId>.mdx`, Haupt-Visualisierung `<lessonId>.steps.ts`, weitere `<lessonId>-<name>.steps.ts`, optional `<lessonId>-verify.ts`.
- Umfang: etwa 1.800 bis 2.800 Wörter, zwei bis vier Visualisierungen, fünf bis sechs Quizfragen.
- Abschnitte (`<Block n={…} title="…">`) in fester Reihenfolge: Das Problem, Das mentale Modell (mit `Callout kind="fehlannahme"`), Durchspielen, ein bis drei Detailabschnitte, Stolperfalle(n), In der Praxis, Was Runtime und JIT dazu tun (falls relevant, mit `Callout kind="version"`), Selbst nachweisen (`VerifyCard`), Prüfen (`Quiz`), Das Wichtigste in Kürze.
- Erst warum, dann wie. Fehlannahmen benennen. Querverweise auf andere Lektionen mit exaktem Titel in Anführungszeichen.
- Step-Skripte: ein Schritt zeigt genau eine Zustandsänderung, Erklärung in zwei bis vier Sätzen, mindestens ein Schritt zur häufigsten Fehlannahme, Adressen erkennbar fiktiv und konsistent, Größen für 64-Bit.

## Visualisierungen
- Ansichten (`view` im Step-Skript): `memory`, `timeline`, `gcheap`, `pipeline`, `buckets`, `layout`, `graph`, `table`. Zustandsformate in `src/lib/viz/types.ts` und `src/lib/viz/views/`, Beispiele unter `/demo/`.
- Die Ansicht muss zum Inhalt passen: `pipeline` nur für lineare Abfolgen, Entscheidungen und Zustände als `graph`, Tabellen mit Verweisen zwischen Zeilen als `table`. Breite Ansichten (`graph`, `table`) mit `layout: 'stacked'`.
- Farbsemantik ist verbindlich (Tokens in `src/styles/tokens.css`): `--stack` lokale Werte, `--heap` verwaltete Objekte, `--ref` Verweise und GC-Roots, `--thread` Threads und Tasks, `--jit` JIT-Phasen und Tiers, `--hl` Änderung im aktuellen Schritt. GC-Generationen bekommen keine eigenen Farben.

## Technische Regeln
- Astro mit `output: 'static'`. Interaktive Teile als React-Islands (`client:visible`).
- TypeScript strict. Keine `any` ohne Begründung im Kommentar.
- Alle internen Links und Assets über den Base-Pfad (`import.meta.env.BASE_URL` bzw. Helper `withBase()`), nie hart mit `/` beginnen. GitHub Pages läuft unter `/the-book-of-dotnet/`.
- Kein Tracking, keine externen Laufzeit-Requests. Schriften liegen lokal (`src/styles/fonts/`).
- Fortschritt nur in `localStorage`, jeder Zugriff in try/catch, App muss ohne Storage voll funktionieren.
- Icons nur aus `src/lib/icons.ts` (Fluent UI System Icons, MIT): `<Icon name="…" />` in Astro und React, `iconSvg()` in Skripten. Keine Unicode-Zeichen als Icons (ein Test prüft das).
- Barrierefreiheit: Tastaturbedienung für Step-Player und Quiz, sichtbarer Fokus, `prefers-reduced-motion` respektieren.

## Befehle
- `npm run dev`: Entwicklungsserver
- `npm run build`: statischer Build nach `dist/` (inklusive Suchindex und Link-Prüfung)
- `npm run preview`: Build lokal ansehen (mit Base-Pfad)
- `npm run check`: `astro check` und ESLint
- `npm run test`: Vitest (u. a. Validierung von Curriculum, Step-Daten, Trennzeichen, Icons)
- `npm run new:lesson -- <chapterId> <lessonId>`: neue Lektion (MDX + Steps) aus der Vorlage, Status `draft`
- `/autor/` (nur `npm run dev`): Status aller Lektionen, offene `TODO(verify)`, fehlende Quellen
- `/demo/` (nur `npm run dev`): alle Visualisierungen mit Beispielskript und Zustandsformat
- Glossar: Begriffe in `src/data/glossary.json` (Definitionen knapp und gesichert), Verlinkung automatisch
- Curriculum: `src/data/curriculum.json` ist die einzige Quelle für Kapitel und Lektionen
