import { defineStepScript, type MemoryState } from '@/components/viz';

// An object is collected while the method that created it is still running, because its local
// is no longer reported as live after its last use (optimized code, Tier 1 or FullOpts).
// Pattern after the GC.KeepAlive documentation (Microsoft Learn) and the GC info liveness rules.
// Addresses and the handle value are fictional but consistent across steps.
// TODO(verify): NativeFile size 24 B on x64 (header 8 B, MethodTable 8 B, IntPtr 8 B).

const ADDR = '0x7F3A0400';
const HANDLE = '0x1A4';

type Obj = MemoryState['heap'][number];
type Slot = MemoryState['frames'][number]['slots'][number];

const file = (type: string, handle: string): Obj => ({
  id: 'file',
  type,
  address: ADDR,
  generation: 0,
  fields: [
    { name: 'Object Header', value: '8 B' },
    { name: 'MethodTable', value: '→ NativeFile' },
    { name: 'Handle', value: handle },
  ],
  sizeBytes: 24,
});

const fileSlot = (mode: 'none' | 'live' | 'dead'): Slot => ({
  id: 'file-slot',
  name: 'file',
  type: 'NativeFile (Verweis, 8 Byte)',
  value: mode === 'none' ? 'null' : mode === 'live' ? ADDR : `${ADDR} (nicht gemeldet)`,
  ...(mode === 'live' ? { ref: 'file' } : {}),
});

const hSlot = (value: string): Slot => ({ id: 'h', name: 'h', type: 'IntPtr (8 Byte)', value });

const run = (slot: Slot, h: string): MemoryState['frames'][number] => ({
  id: 'run',
  method: 'Run()',
  slots: [slot, hSlot(h)],
});

const native = {
  id: 'native',
  method: 'ReadAll(h) (nativer Code)',
  slots: [{ id: 'arg', name: 'handle', type: 'IntPtr', value: HANDLE }],
};

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Ein Objekt stirbt, während seine Methode noch läuft',
  code: {
    cs: `static void Run()
{
    var file = new NativeFile("daten.bin");
    IntPtr h = file.Handle;
    NativeApi.ReadAll(h);     // läuft lange
    // GC.KeepAlive(file);    // fehlt
}

class NativeFile
{
    public IntPtr Handle;
    ~NativeFile() => NativeApi.Close(Handle);
}`,
  },
  steps: [
    {
      codeLine: 3,
      state: {
        frames: [run(fileSlot('live'), '0')],
        heap: [file('NativeFile', `${HANDLE} (offen)`)],
      },
      changed: ['file-slot', 'file'],
      explanation:
        '`Run` legt ein `NativeFile` an. Es hält ein Betriebssystem-Handle und hat einen Finalizer, der das Handle schließt. Der Verweis steht in `file`.',
    },
    {
      codeLine: 4,
      state: {
        frames: [run(fileSlot('live'), HANDLE)],
        heap: [file('NativeFile', `${HANDLE} (offen)`)],
      },
      changed: ['h'],
      explanation:
        '`h` bekommt eine Kopie des Handles, eine bloße Zahl. Das ist die **letzte Verwendung** von `file`. Für den JIT ist die Variable ab hier tot, auch wenn sie im Quelltext bis zur schließenden Klammer sichtbar ist.',
    },
    {
      codeLine: 5,
      state: {
        frames: [run(fileSlot('dead'), HANDLE), native],
        heap: [file('NativeFile', `${HANDLE} (offen)`)],
      },
      changed: ['file-slot', 'arg'],
      explanation:
        '`ReadAll` läuft. Im Register oder Slot von `file` steht vielleicht noch die Adresse, aber die GC-Info meldet an dieser Aufrufstelle keinen lebenden Verweis. Die Fehlannahme „das Objekt lebt bis zum Ende der Methode“ trifft auf optimierten Code nicht zu.',
    },
    {
      codeLine: 5,
      state: {
        frames: [run(fileSlot('dead'), HANDLE), native],
        heap: [file('NativeFile (unerreichbar, Finalizer steht an)', `${HANDLE} (offen)`)],
      },
      changed: ['file'],
      explanation:
        'Ein anderer Thread löst eine GC aus. Der Thread in `ReadAll` steckt in nativem Code und muss dafür nicht einmal angehalten werden. Von keiner Root aus ist das `NativeFile` erreichbar, weil es einen Finalizer hat, kommt es in die Warteschlange für den Finalizer-Thread.',
    },
    {
      codeLine: 12,
      state: {
        frames: [run(fileSlot('dead'), HANDLE), native],
        heap: [file('NativeFile (finalisiert)', `${HANDLE} (geschlossen)`)],
        output: 'ReadAll: Fehler, Handle ungültig',
      },
      changed: ['file.Handle'],
      explanation:
        'Der Finalizer-Thread schließt das Handle, während `ReadAll` es noch benutzt. Im harmlosen Fall scheitert der Aufruf. Im schlimmen Fall vergibt das Betriebssystem dieselbe Handle-Nummer neu, und `ReadAll` liest aus einer fremden Datei.',
    },
    {
      codeLine: 6,
      state: {
        frames: [run(fileSlot('live'), HANDLE), native],
        heap: [file('NativeFile', `${HANDLE} (offen)`)],
      },
      changed: ['file-slot'],
      explanation:
        'Mit `GC.KeepAlive(file)` nach dem Aufruf gibt es eine spätere Verwendung. Der JIT muss `file` bis dorthin lebendig halten, also meldet die GC-Info den Verweis auch an der Aufrufstelle von `ReadAll`. `KeepAlive` selbst tut nichts, es ist nur diese Verwendung.',
    },
  ],
});
