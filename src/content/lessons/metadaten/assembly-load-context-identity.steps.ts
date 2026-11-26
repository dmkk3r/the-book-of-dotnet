import { defineStepScript, type MemoryState } from '@/components/viz';

// Type identity across ALCs after "About AssemblyLoadContext" on Microsoft Learn ("they're the same
// type if and only if they come from the same Assembly instance") and the plugin tutorial
// (Private=false keeps PluginBase.dll out of the plugin folder so the shared copy is used).
// A cast compares the object's MethodTable against the target type (see "MethodTable und EEClass").
// Addresses are fictional but consistent.
// TODO(verify): Exact InvalidCastException message for this case on .NET 8 ("Unable to cast object
// of type 'Contracts.Message' to type 'Contracts.Message'.").

type Obj = MemoryState['heap'][number];

const mtDefault: Obj = {
  id: 'mt-default',
  type: 'MethodTable Contracts.Message (Default-Kontext)',
  address: '0x7FFA1000',
  fields: [
    { name: 'Assembly', value: 'Contracts.dll aus der TPA-Liste' },
    { name: 'Loader Heap', value: 'des Default-Kontexts' },
  ],
};
const mtPlugin: Obj = {
  id: 'mt-plugin',
  type: 'MethodTable Contracts.Message (Plugin-Kontext)',
  address: '0x7FFB2000',
  fields: [
    { name: 'Assembly', value: 'Contracts.dll aus plugins/Wetter' },
    { name: 'Loader Heap', value: 'des Plugin-Kontexts' },
  ],
};
const msg = (mt: 'mt-default' | 'mt-plugin'): Obj => ({
  id: 'msg',
  type: 'Contracts.Message',
  address: '0x7F3A0300',
  generation: 0,
  fields: [
    {
      name: 'MethodTable',
      value: mt === 'mt-plugin' ? '→ Message (Plugin)' : '→ Message (Default)',
      ref: mt,
    },
    { name: 'Text', value: '"Sonnig"' },
  ],
});

type Slot = MemoryState['frames'][number]['slots'][number];
const slots = (o: boolean, m: 'none' | 'fail' | 'ok'): Slot[] => [
  {
    id: 'o',
    name: 'o',
    type: 'object (Verweis)',
    value: o ? '0x7F3A0300' : 'null',
    ...(o ? { ref: 'msg' } : {}),
  },
  {
    id: 'm',
    name: 'm',
    type: 'Message (Verweis)',
    value: m === 'ok' ? '0x7F3A0300' : m === 'fail' ? 'Cast gescheitert' : 'null',
    ...(m === 'ok' ? { ref: 'msg' } : {}),
  },
];
const frames = (o: boolean, m: 'none' | 'fail' | 'ok'): MemoryState['frames'] => [
  { id: 'host', method: 'Host.Main()', slots: slots(o, m) },
];

export default defineStepScript({
  view: 'memory',
  layout: 'stacked',
  title: 'Gleicher Name, zwei Typen',
  code: {
    cs: `// Contracts.dll, vom Host und vom Plugin benutzt
public class Message { public string Text = ""; }

// im Host
var ctx = new PluginLoadContext(@"plugins/Wetter/Wetter.dll");
var plugin = ctx.LoadFromAssemblyPath(@"plugins/Wetter/Wetter.dll");
object o = plugin.GetType("Wetter.Bericht")!
                 .GetMethod("Heute")!.Invoke(null, null)!;
var m = (Message)o;`,
  },
  steps: [
    {
      codeLine: 2,
      state: { frames: frames(false, 'none'), heap: [mtDefault] },
      changed: ['mt-default'],
      explanation:
        'Der Host benutzt `Message` und hat deshalb `Contracts.dll` im Default-Kontext geladen. Dort gibt es jetzt eine MethodTable für `Contracts.Message`.',
    },
    {
      codeLine: 6,
      state: { frames: frames(false, 'none'), heap: [mtDefault, mtPlugin] },
      changed: ['mt-plugin'],
      explanation:
        'Das Plugin wurde mit einer Kopie von `Contracts.dll` in seinem Ordner ausgeliefert. Der Resolver findet sie, `Load` lädt sie in den Plugin-Kontext. Gleicher Name, gleiche Version, sogar gleiche Bytes, und trotzdem eine **zweite Assembly** mit einer **zweiten MethodTable**.',
    },
    {
      codeLine: 7,
      state: { frames: frames(true, 'none'), heap: [mtDefault, mtPlugin, msg('mt-plugin')] },
      changed: ['o', 'msg', 'msg.MethodTable'],
      explanation:
        'Das Plugin erzeugt ein `Message`-Objekt. Sein Code wurde gegen den Typ im eigenen Kontext gebunden, also zeigt das Objekt auf die MethodTable des Plugin-Kontexts. Als `object` kommt es problemlos beim Host an.',
    },
    {
      codeLine: 9,
      state: { frames: frames(true, 'fail'), heap: [mtDefault, mtPlugin, msg('mt-plugin')] },
      changed: ['m', 'msg.MethodTable'],
      explanation:
        'Der Cast prüft, ob die MethodTable des Objekts zum Zieltyp passt. Der Host meint `Message` aus dem Default-Kontext, das Objekt hat die des Plugin-Kontexts. Ergebnis: **InvalidCastException** mit der verwirrenden Meldung, `Contracts.Message` lasse sich nicht in `Contracts.Message` umwandeln.',
    },
    {
      codeLine: 6,
      state: { frames: frames(true, 'ok'), heap: [mtDefault, msg('mt-default')] },
      changed: ['m', 'msg.MethodTable'],
      explanation:
        'Die Lösung: Das Plugin bringt `Contracts.dll` nicht mit (im Projekt `Private` auf `false`). Dann liefert `Load` für `Contracts` `null`, der Default-Kontext springt ein, und beide Seiten benutzen dieselbe Assembly. Es gibt nur noch eine MethodTable, und der Cast gelingt.',
    },
    {
      codeLine: 2,
      state: { frames: frames(true, 'ok'), heap: [mtDefault, msg('mt-default')] },
      changed: ['mt-default'],
      explanation:
        'Fehlannahme: „Zwei Typen mit gleichem Namen aus gleicher Assembly-Version sind derselbe Typ.“ Zur Identität eines Typs gehört die **Assembly-Instanz**, und damit der Kontext, in den sie geladen wurde. Gemeinsame Verträge gehören deshalb in genau einen Kontext, in der Regel den Default-Kontext.',
    },
  ],
});
