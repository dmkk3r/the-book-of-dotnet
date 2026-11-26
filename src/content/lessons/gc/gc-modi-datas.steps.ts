import { defineStepScript, type TimelineState } from '@/components/viz';

// Time units are abstract. Verified (Microsoft Learn, DATAS and GC config pages): DATAS starts
// with one heap, grows and reduces the number of heaps as needed (from one up to the core count),
// allocating threads can wait at startup and when load increases because "it takes a few GCs
// before the number of heaps gets increased", default target TCP 2%.
// TODO(verify): Heap count changes take effect at GCs (gc.cpp, dynamic heap count, change_heap_count)
// and the exact steps by which the count grows (here 1, 2, 4 on a four core machine) are illustrative.

type Item = TimelineState['items'][number];

const lanes: TimelineState['lanes'] = [
  { id: 'load', label: 'Last', kind: 'io' },
  { id: 'alloc', label: 'Allozierende Threads', kind: 'pool' },
  { id: 'h0', label: 'Heap 0' },
  { id: 'h1', label: 'Heap 1' },
  { id: 'h2', label: 'Heap 2' },
  { id: 'h3', label: 'Heap 3' },
];

const item = (
  id: string,
  lane: string,
  start: number,
  end: number,
  label: string,
  kind: Item['kind'] = 'run',
): Item => ({ id, lane, start, end, label, kind });

const low = item('load-low', 'load', 0, 6, 'wenig Anfragen', 'wait');
const startHeap = item('heap0', 'h0', 0, 26, 'Heap 0');
const allocLow = item('alloc-low', 'alloc', 0, 6, 'allozieren');

const peak = item('load-peak', 'load', 6, 18, 'Spitzenlast', 'wait');
const contention = item('alloc-wait', 'alloc', 6, 9, 'warten auf Allokation', 'blocked');
const h1 = item('heap1', 'h1', 9, 21, 'Heap 1');
const allocMid = item('alloc-mid', 'alloc', 9, 12, 'allozieren');
const h2 = item('heap2', 'h2', 12, 21, 'Heap 2');
const h3 = item('heap3', 'h3', 12, 21, 'Heap 3');
const allocPeak = item('alloc-peak', 'alloc', 12, 18, 'allozieren');

const calm = item('load-calm', 'load', 18, 26, 'wenig Anfragen', 'wait');
const allocCalm = item('alloc-calm', 'alloc', 18, 26, 'allozieren');

export default defineStepScript({
  view: 'timeline',
  title: 'DATAS passt die Zahl der Heaps an die Last an',
  layout: 'stacked',
  code: {
    cs: `// ASP.NET Core Dienst, .NET 9, Server GC (DATAS standardmäßig an), vier Kerne
app.MapGet("/orders", async (OrderService s) =>
{
    var list = await s.LoadAsync();   // alloziert pro Anfrage
    return Results.Ok(list);
});`,
  },
  steps: [
    {
      codeLine: 1,
      state: { lanes, duration: 26, items: [low, allocLow, startHeap], now: 6 },
      changed: ['heap0', 'load-low'],
      explanation:
        'DATAS startet **immer mit einem Heap**, wie Workstation GC. Solange wenig los ist, reicht das: Der Heap bleibt klein, und die GCs sind billig.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 26,
        items: [low, allocLow, startHeap, peak, contention],
        now: 9,
      },
      changed: ['load-peak', 'alloc-wait'],
      explanation:
        'Die Spitzenlast beginnt. Viele Threads allozieren über einen einzigen Heap, es gibt häufige GCs, und manche Threads müssen beim Allozieren **warten**. DATAS misst diese Kosten als Anteil an der Laufzeit, die Throughput Cost Percentage.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 26,
        items: [low, allocLow, startHeap, peak, contention, h1, allocMid],
        now: 12,
      },
      changed: ['heap1'],
      explanation:
        'Liegen die Kosten über dem Ziel (standardmäßig 2 Prozent), erhöht DATAS die Zahl der Heaps. Das passiert nicht sofort, sondern nach einigen GCs. Bis dahin bleiben die Wartezeiten.',
    },
    {
      codeLine: 4,
      state: {
        lanes,
        duration: 26,
        items: [low, allocLow, startHeap, peak, contention, h1, allocMid, h2, h3, allocPeak],
        now: 18,
      },
      changed: ['heap2', 'heap3', 'alloc-peak'],
      explanation:
        'Unter Volllast landet DATAS bei so vielen Heaps, wie die Last braucht, höchstens bei der Zahl der Kerne. Jetzt verhält es sich ähnlich wie klassischer Server GC, mit einem Unterschied: Die Gen0-Budgets richten sich nach der Größe der langlebigen Daten.',
    },
    {
      codeLine: 5,
      state: {
        lanes,
        duration: 26,
        items: [
          low,
          allocLow,
          startHeap,
          peak,
          contention,
          h1,
          allocMid,
          h2,
          h3,
          allocPeak,
          calm,
          allocCalm,
        ],
        now: 26,
      },
      changed: ['load-calm', 'heap1', 'heap2', 'heap3'],
      explanation:
        'Die Last sinkt, und DATAS **reduziert** die Heaps wieder, hier zurück auf einen. Häufige Fehlannahme: „Server GC gibt Speicher von selbst zurück, wenn weniger los ist.“ Klassischer Server GC verkleinert den Heap nicht unbedingt aggressiv, genau dafür wurde DATAS gebaut.',
    },
  ],
});
