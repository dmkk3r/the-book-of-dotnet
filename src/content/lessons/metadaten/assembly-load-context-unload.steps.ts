import { defineStepScript, type MemoryState } from '@/components/viz';

// Cooperative unloading after "How to use and debug assembly unloadability" on Microsoft Learn:
// Unload only initiates unloading; it completes once no thread has methods of the context on its
// stack and nothing outside the context (except weak references) references its assemblies, types
// or instances; the runtime holds a strong handle to the ALC while unloading is in progress; the
// debugging section looks for the managed LoaderAllocator object of the context.
// Addresses are fictional but consistent.
// TODO(verify): That an instance of a collectible type keeps its LoaderAllocator alive through its
// MethodTable (the GC reports the LoaderAllocator object for collectible MethodTables), modeled
// here as a reference from the MethodTable to the LoaderAllocator.
// TODO(verify): That the ALC object is referenced by its LoaderAllocator (or the native
// AssemblyLoaderAllocator) during unloading and is collected together with it.
// TODO(verify): That a context in the unloading state refuses further loads, and that the
// LoaderAllocatorScout finalizer is why more than one GC is usually needed.

type Obj = MemoryState['heap'][number];

const alcObj: Obj = {
  id: 'alc',
  type: 'PluginLoadContext (entladbar)',
  address: '0x7F3A0400',
  generation: 0,
  fields: [
    { name: 'IsCollectible', value: 'true' },
    { name: 'Loader', value: '→ LoaderAllocator', ref: 'la' },
  ],
};
const la = (state: 'aktiv' | 'entladen'): Obj => ({
  id: 'la',
  type: 'LoaderAllocator',
  address: '0x7F3A0440',
  generation: 0,
  fields: [{ name: 'Zustand', value: state === 'aktiv' ? 'aktiv' : 'Unload angestoßen' }],
});
const mt: Obj = {
  id: 'mt',
  type: 'MethodTable Wetter.Bericht (Loader Heap des Kontexts)',
  address: '0x7FFB3000',
  fields: [{ name: 'LoaderAllocator', value: '→ hält ihn am Leben', ref: 'la' }],
};
const plug: Obj = {
  id: 'plug',
  type: 'Wetter.Bericht',
  address: '0x7F3A0480',
  generation: 0,
  fields: [{ name: 'MethodTable', value: '→ Bericht', ref: 'mt' }],
};
const cache = (holds: boolean): Obj => ({
  id: 'cache',
  type: 'List<object> (statisches Feld im Host)',
  address: '0x7F3A0100',
  generation: 2,
  fields: [
    { name: '[0]', value: holds ? '0x7F3A0480' : 'leer', ...(holds ? { ref: 'plug' } : {}) },
  ],
});

type Slot = MemoryState['frames'][number]['slots'][number];
const ref = (id: string, type: string, target?: Obj): Slot => ({
  id,
  name: id,
  type,
  value: target ? target.address : 'null',
  ...(target ? { ref: target.id } : {}),
});

const mainFrame = (alive: string): MemoryState['frames'][number] => ({
  id: 'main',
  method: 'Main()',
  slots: [{ id: 'weak', name: 'weak', type: 'WeakReference', value: `IsAlive: ${alive}` }],
});
const runFrame = (withObj: boolean): MemoryState['frames'][number] => ({
  id: 'run',
  method: 'Run()',
  slots: [
    ref('ctx', 'PluginLoadContext (Verweis)', alcObj),
    ref('bericht', 'object (Verweis)', withObj ? plug : undefined),
  ],
});

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Entladen ist kooperativ',
  code: {
    cs: `static readonly List<object> Cache = new();

[MethodImpl(MethodImplOptions.NoInlining)]
static WeakReference Run()
{
    var ctx = new PluginLoadContext(@"plugins/Wetter/Wetter.dll"); // isCollectible: true
    object bericht = ctx.LoadFromAssemblyPath(@"plugins/Wetter/Wetter.dll")
        .GetType("Wetter.Bericht")!.GetMethod("Heute")!.Invoke(null, null)!;
    Cache.Add(bericht);
    ctx.Unload();
    return new WeakReference(ctx);
}

var weak = Run();
GC.Collect(); GC.WaitForPendingFinalizers();
Cache.Clear();
for (int i = 0; weak.IsAlive && i < 10; i++) { GC.Collect(); GC.WaitForPendingFinalizers(); }`,
  },
  steps: [
    {
      codeLine: 9,
      state: {
        frames: [mainFrame('noch nicht angelegt'), runFrame(true)],
        heap: [cache(true), alcObj, la('aktiv'), mt, plug],
      },
      changed: ['ctx', 'bericht', 'alc', 'la', 'mt', 'plug', 'cache.[0]'],
      explanation:
        'Ein entladbarer Kontext hat seinen eigenen **LoaderAllocator**, dem der Loader Heap mit den MethodTables des Plugins gehört. Ein Objekt des Plugins hält über seine MethodTable diesen LoaderAllocator am Leben. Der Host merkt sich das Objekt zusätzlich in einem statischen Cache.',
    },
    {
      codeLine: 10,
      state: {
        frames: [mainFrame('noch nicht angelegt'), runFrame(true)],
        heap: [cache(true), alcObj, la('entladen'), mt, plug],
      },
      changed: ['la.Zustand'],
      explanation:
        '`Unload()` kehrt sofort zurück und hat **nichts freigegeben**. Es stößt das Entladen nur an: Das Ereignis `Unloading` wird ausgelöst, und der Kontext nimmt keine neuen Assemblies mehr an. Fertig ist das Entladen erst, wenn der GC feststellt, dass nichts mehr in den Kontext zeigt.',
    },
    {
      codeLine: 15,
      state: {
        frames: [mainFrame('true')],
        heap: [cache(true), alcObj, la('entladen'), mt, plug],
      },
      changed: ['weak'],
      explanation:
        '`Run` ist zurückgekehrt, ihre lokalen Variablen sind weg. Trotzdem überlebt alles die Collection: Der statische Cache zeigt auf das Plugin-Objekt, das Objekt auf seine MethodTable, die MethodTable auf den LoaderAllocator. `weak.IsAlive` bleibt `true`.',
    },
    {
      codeLine: 16,
      state: {
        frames: [mainFrame('true')],
        heap: [cache(false), alcObj, la('entladen'), mt, plug],
      },
      changed: ['cache.[0]'],
      explanation:
        'Erst `Cache.Clear()` kappt den letzten starken Verweis von außen. Jetzt ist der ganze Kontext von keiner Wurzel mehr erreichbar. Freigegeben ist aber immer noch nichts, bis der GC das nächste Mal läuft.',
    },
    {
      codeLine: 17,
      state: { frames: [mainFrame('false')], heap: [cache(false)] },
      changed: ['weak'],
      explanation:
        'Die folgenden Collections räumen erst die Objekte und den LoaderAllocator ab, dann kann die Runtime den Loader Heap mit allen MethodTables, den JIT-Code und die Assemblies freigeben. Weil dabei Finalizer mitspielen, die der Runtime und vielleicht auch die des Plugins, kann es mehr als eine Collection brauchen, deshalb die Schleife.',
    },
    {
      codeLine: 10,
      state: { frames: [mainFrame('false')], heap: [cache(false)] },
      changed: ['weak'],
      explanation:
        'Fehlannahme: „`Unload()` entlädt sofort.“ Es ist ein Wunsch, kein Befehl. Solange ein Thread Code des Plugins ausführt oder irgendein starker Verweis, ein statisches Feld oder ein GC-Handle von außen hineinzeigt, bleibt alles im Speicher, ohne Fehlermeldung.',
    },
  ],
});
