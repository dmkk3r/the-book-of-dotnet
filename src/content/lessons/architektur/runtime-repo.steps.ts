import { defineStepScript, type PipelineState } from '@/components/viz';

// Path of GC.Collect() from the public API down to the GC, read at tag v9.0.0 of dotnet/runtime.
// Checked 2026-11 against raw files at tag v9.0.0:
//   src/coreclr/System.Private.CoreLib/src/System/GC.CoreCLR.cs (Collect, _Collect as QCall "GCInterface_Collect")
//   src/coreclr/vm/qcallentrypoints.cpp (DllImportEntry(GCInterface_Collect))
//   src/coreclr/vm/comutilnative.cpp (GCInterface_Collect: GCX_COOP, GetGCHeap()->GarbageCollect)
//   src/coreclr/gc/gc.cpp (GCHeap::GarbageCollect)
// In release/10.0 _Collect has a third parameter (lowMemoryPressure); in main the QCall table moved to
// src/coreclr/vm/runtimehelpers.cpp. The lesson text points that out.
// TODO(verify): That the LibraryImport source generator emits a plain DllImport to "QCall" and that the
// runtime resolves it through the QCall table (QCallResolveDllImport in qcall.cpp or similar).

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'api',
    label: 'Öffentliche API',
    detail: 'GC.Collect() in CoreLib',
    status: status[0] ?? 'pending',
  },
  {
    id: 'decl',
    label: 'QCall-Deklaration',
    detail: '[LibraryImport(QCall)]',
    status: status[1] ?? 'pending',
  },
  {
    id: 'table',
    label: 'Einsprungtabelle',
    detail: 'qcallentrypoints.cpp',
    status: status[2] ?? 'pending',
  },
  {
    id: 'vm',
    label: 'VM-Funktion',
    detail: 'comutilnative.cpp',
    status: status[3] ?? 'pending',
  },
  {
    id: 'gc',
    label: 'GC',
    detail: 'gc/gc.cpp',
    status: status[4] ?? 'pending',
  },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Von GC.Collect() bis in den GC (Tag v9.0.0)',
  code: {
    cs: `// src/coreclr/System.Private.CoreLib/src/System/GC.CoreCLR.cs
public static void Collect()
{
    // -1 says to GC all generations.
    _Collect(-1, (int)InternalGCCollectionMode.Blocking);
}

[LibraryImport(RuntimeHelpers.QCall, EntryPoint = "GCInterface_Collect")]
private static partial void _Collect(int generation, int mode);

// src/coreclr/vm/qcallentrypoints.cpp (C++)
//   DllImportEntry(GCInterface_Collect)

// src/coreclr/vm/comutilnative.cpp (C++)
//   extern "C" void QCALLTYPE GCInterface_Collect(INT32 generation, INT32 mode)
//   {
//       QCALL_CONTRACT;
//       BEGIN_QCALL;
//       GCX_COOP();
//       GCHeapUtilities::GetGCHeap()->GarbageCollect(generation, false, mode);
//       END_QCALL;
//   }

// src/coreclr/gc/gc.cpp (C++)
//   HRESULT GCHeap::GarbageCollect(int generation, bool low_memory_p, int mode)`,
  },
  steps: [
    {
      codeLine: 2,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'GC.CoreCLR.cs' },
          { id: 'f-lang', label: 'Sprache', value: 'C#' },
          { id: 'f-asm', label: 'Assembly', value: 'System.Private.CoreLib' },
        ],
      },
      changed: ['api', 'f-file', 'f-lang', 'f-asm'],
      explanation:
        'Die öffentliche Methode `GC.Collect()` ist gewöhnliches C# in CoreLib. Die Datei liegt unter `src/coreclr/`, nicht unter `src/libraries/`, weil sie nur für CoreCLR gilt. Die Endung `.CoreCLR.cs` verrät das schon im Namen.',
    },
    {
      codeLine: 5,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'GC.CoreCLR.cs' },
          { id: 'f-call', label: 'Aufruf', value: '_Collect(-1, Blocking)' },
        ],
      },
      changed: ['decl', 'f-call'],
      explanation:
        'Die Arbeit macht eine private Methode `_Collect`. Die Argumente prüft schon der C#-Code, `-1` steht für „alle Generationen“. Erst jetzt geht es über die Grenze zu nativem Code.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-mech', label: 'Mechanismus', value: 'QCall' },
          { id: 'f-lib', label: 'Bibliotheksname', value: '"QCall"' },
          { id: 'f-entry', label: 'EntryPoint', value: 'GCInterface_Collect' },
        ],
      },
      changed: ['f-mech', 'f-lib', 'f-entry'],
      explanation:
        '`_Collect` ist ein **QCall**: technisch ein P/Invoke, aber auf die Pseudobibliothek `"QCall"`. Der Wert von `EntryPoint` ist der Suchbegriff für die nächste Station. Kopier ihn und such ihn im ganzen Repo.',
    },
    {
      codeLine: 12,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'src/coreclr/vm/qcallentrypoints.cpp' },
          { id: 'f-entry', label: 'Eintrag', value: 'DllImportEntry(GCInterface_Collect)' },
        ],
      },
      changed: ['table', 'f-file', 'f-entry'],
      explanation:
        'Die Runtime lädt dafür keine DLL. Sie schaut in eine eingebaute Tabelle aller QCalls. Der Eintrag verbindet den Namen aus C# mit der Adresse der C++-Funktion, die genau so heißt.',
    },
    {
      codeLine: 15,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'src/coreclr/vm/comutilnative.cpp' },
          { id: 'f-mode', label: 'GC-Modus beim Eintritt', value: 'präemptiv (wie P/Invoke)' },
          { id: 'f-coop', label: 'GCX_COOP()', value: 'zurück in kooperativ' },
        ],
      },
      changed: ['vm', 'f-file', 'f-mode', 'f-coop'],
      explanation:
        'Die VM-Funktion ist kurz. Wie jeder P/Invoke kommt ein QCall im **präemptiven** Modus an, der GC dürfte also parallel laufen. Bevor sie den GC anstößt, wechselt sie mit `GCX_COOP()` zurück in den kooperativen Modus.',
    },
    {
      codeLine: 25,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'src/coreclr/gc/gc.cpp' },
          { id: 'f-iface', label: 'Schnittstelle', value: 'IGCHeap (gcinterface.h)' },
        ],
      },
      changed: ['gc', 'f-file', 'f-iface'],
      explanation:
        'Über `GCHeapUtilities::GetGCHeap()` spricht die VM den GC nur über die Schnittstelle `IGCHeap` an. Die Implementierung liegt im Ordner `src/coreclr/gc`, getrennt von der VM. Diese Grenze ist der Grund, warum sich der GC auch als eigene Bibliothek laden lässt.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-hops', label: 'Stationen', value: '4 Dateien, 2 Sprachen' },
          { id: 'f-key', label: 'Suchschlüssel', value: 'GCInterface_Collect' },
          { id: 'f-ver', label: 'Gelesen bei', value: 'Tag v9.0.0' },
        ],
      },
      changed: ['f-hops', 'f-key', 'f-ver'],
      explanation:
        'Der ganze Weg hing an einem einzigen Bezeichner. Das ist das Muster für jede Suche: Vom C#-Attribut zum Namen, vom Namen zur Tabelle, von der Tabelle zur Funktion. In späteren Versionen hat sich die Tabelle verschoben, das Muster nicht.',
    },
  ],
});
