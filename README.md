# The Book of .NET

Eine interaktive Lernplattform zu den Interna der .NET-Runtime, auf Deutsch. Jede Lektion erklärt ein Thema in der Tiefe (Typsystem, Garbage Collector, JIT, Threading, Async und mehr) und zeigt in Schritt-für-Schritt-Visualisierungen, was im Speicher, im JIT oder in den Threads passiert. Dazu gibt es Quizfragen und Anleitungen, wie du das Gelernte mit SharpLab oder BenchmarkDotNet selbst nachweist.

> Inoffizielles Lernprojekt, nicht mit Microsoft verbunden. Viele Lektionen sind noch Entwürfe: Konkrete Zahlen, IL und Assembler sind dort noch nicht selbst nachgemessen.

## Entwicklung

Voraussetzung: Node 24 (siehe `.nvmrc`).

```sh
npm install
npm run dev       # Entwicklungsserver
npm run check     # astro check und ESLint
npm run test      # Vitest
npm run build     # statischer Build nach dist/ (Suchindex und Link-Prüfung)
npm run preview   # Build lokal ansehen
npm run new:lesson -- <chapterId> <lessonId>   # neue Lektion aus der Vorlage
```

Die Suche nutzt einen Index, der nur beim Build entsteht. Zum Ausprobieren: `npm run build && npm run preview`.

Im Entwicklungsmodus gibt es zusätzlich `/autor/` (Status aller Lektionen, offene Prüfpunkte) und `/demo/` (alle Visualisierungen).

## Aufbau

- `src/content/lessons/`: Lektionen (MDX) und ihre Visualisierungen (`*.steps.ts`)
- `src/data/`: Curriculum und Glossar
- `src/components/viz/`: Step-Player und Visualisierungen
- `src/lib/viz/`: Zustandsformate, Validierung und Pfeil-Routing der Visualisierungen
- `.github/workflows/deploy.yml`: Build und Veröffentlichung auf GitHub Pages

Regeln für Inhalte und Code stehen in `CLAUDE.md`.

## Lizenz

- Code: MIT, siehe [`LICENSE`](LICENSE)
- Inhalte (Lektionen, Visualisierungsinhalte, Glossar, Curriculum): CC BY 4.0, siehe [`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)
- Icons: Fluent UI System Icons (Microsoft, MIT). Schrift: Selawik (Microsoft, SIL OFL 1.1).
