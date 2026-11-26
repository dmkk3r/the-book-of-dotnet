import { defineStepScript, type PipelineState } from '@/components/viz';

// Object.GetType() as an FCall in .NET 9 and as managed code in .NET 10.
// Checked 2026-11 against raw files:
//   v9.0.0: src/coreclr/System.Private.CoreLib/src/System/Object.CoreCLR.cs
//           ([Intrinsic] [MethodImpl(MethodImplOptions.InternalCall)] public extern Type GetType();)
//   v9.0.0: src/coreclr/vm/ecalllist.h (FCFuncStart(gObjectFuncs) FCFuncElement("GetType", ObjectNative::GetClass),
//           FCClassElement("Object", "System", gObjectFuncs))
//   v9.0.0: src/coreclr/classlibnative/bcltype/objectnative.cpp (FCIMPL1(Object*, ObjectNative::GetClass, ...),
//           fast path GetManagedClassObjectIfExists, slow path GetClassHelper with a helper method frame)
//   release/10.0: Object.CoreCLR.cs GetType() is C#: RuntimeHelpers.GetMethodTable + RuntimeTypeHandle.GetRuntimeType
// TODO(verify): That the JIT expands Object.GetType() as an intrinsic in many cases (e.g. typeof(X) == o.GetType()),
// so the FCall is not always reached at run time.

type Stage = PipelineState['stages'][number];
type Status = Stage['status'];

const stages = (...status: Status[]): Stage[] => [
  {
    id: 'decl',
    label: 'Deklaration',
    detail: 'extern + InternalCall',
    status: status[0] ?? 'pending',
  },
  {
    id: 'list',
    label: 'FCall-Liste',
    detail: 'vm/ecalllist.h',
    status: status[1] ?? 'pending',
  },
  {
    id: 'impl',
    label: 'C++-Implementierung',
    detail: 'objectnative.cpp',
    status: status[2] ?? 'pending',
  },
  {
    id: 'next',
    label: 'Nächste Version',
    detail: 'release/10.0',
    status: status[3] ?? 'pending',
  },
];

export default defineStepScript({
  view: 'pipeline',
  layout: 'stacked',
  title: 'Object.GetType() als FCall und was eine Version später daraus wurde',
  code: {
    cs: `// v9.0.0: src/coreclr/System.Private.CoreLib/src/System/Object.CoreCLR.cs
[Intrinsic]
[MethodImpl(MethodImplOptions.InternalCall)]
public extern Type GetType();

// v9.0.0: src/coreclr/vm/ecalllist.h (C++)
//   FCFuncStart(gObjectFuncs)
//       FCFuncElement("GetType", ObjectNative::GetClass)
//   FCFuncEnd()
//   FCClassElement("Object", "System", gObjectFuncs)

// v9.0.0: src/coreclr/classlibnative/bcltype/objectnative.cpp (C++)
//   FCIMPL1(Object*, ObjectNative::GetClass, Object* pThis)
//   schneller Weg: pMT->GetManagedClassObjectIfExists()
//   langsamer Weg: GetClassHelper(objRef), mit Helper Frame

// release/10.0: dieselbe Datei, jetzt C#
public unsafe Type GetType()
{
    MethodTable* pMT = RuntimeHelpers.GetMethodTable(this);
    RuntimeType type = RuntimeTypeHandle.GetRuntimeType(pMT);
    GC.KeepAlive(this);
    return type;
}`,
  },
  steps: [
    {
      codeLine: 4,
      state: {
        stages: stages('active'),
        facts: [
          { id: 'f-attr', label: 'Kennzeichen', value: 'extern, InternalCall' },
          { id: 'f-body', label: 'Rumpf in C#', value: 'keiner' },
        ],
      },
      changed: ['decl', 'f-attr', 'f-body'],
      explanation:
        'In .NET 9 hat `GetType()` keinen C#-Rumpf. `extern` zusammen mit `MethodImplOptions.InternalCall` heißt: Die Implementierung liefert die Runtime selbst. Das ist das Erkennungszeichen eines **FCall**.',
    },
    {
      codeLine: 8,
      state: {
        stages: stages('done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'src/coreclr/vm/ecalllist.h' },
          { id: 'f-key', label: 'Schlüssel', value: '"Object" in "System", Methode "GetType"' },
          { id: 'f-target', label: 'Ziel', value: 'ObjectNative::GetClass' },
        ],
      },
      changed: ['list', 'f-file', 'f-key', 'f-target'],
      explanation:
        'Anders als beim QCall steht hier kein Einsprungname im C#-Code. Die Zuordnung geschieht über Klassen- und Methodennamen in `ecalllist.h`. Such dort nach dem **Methodennamen in Anführungszeichen**, dann findest du die C++-Funktion.',
    },
    {
      codeLine: 13,
      state: {
        stages: stages('done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'classlibnative/bcltype/objectnative.cpp' },
          { id: 'f-fast', label: 'Schneller Weg', value: 'Type-Objekt existiert schon' },
          { id: 'f-slow', label: 'Langsamer Weg', value: 'Type-Objekt anlegen, mit Frame' },
        ],
      },
      changed: ['impl', 'f-file', 'f-fast', 'f-slow'],
      explanation:
        'Die C++-Funktion bekommt das Objekt als rohen Zeiger. Gibt es zum Typ schon ein `Type`-Objekt, liefert sie es sofort zurück. Sonst muss sie eines anlegen, das kann einen GC auslösen, und dafür baut sie erst einen **Frame** auf. Genau diese Handarbeit macht FCalls fehleranfällig.',
    },
    {
      codeLine: 18,
      state: {
        stages: stages('done', 'done', 'done', 'active'),
        facts: [
          { id: 'f-file', label: 'Datei', value: 'Object.CoreCLR.cs (release/10.0)' },
          { id: 'f-body', label: 'Rumpf in C#', value: 'ja, 4 Zeilen' },
          { id: 'f-target', label: 'Eintrag in ecalllist.h', value: 'entfernt' },
        ],
      },
      changed: ['next', 'f-file', 'f-body', 'f-target'],
      explanation:
        'In `release/10.0` ist dieselbe Methode gewöhnliches C#: MethodTable lesen, zugehöriges `RuntimeType` nachschlagen. Das Book of the Runtime nennt das ausdrücklich als Richtung: FCalls nach und nach durch verwalteten Code oder QCalls ersetzen.',
    },
    {
      codeLine: 18,
      state: {
        stages: stages('done', 'done', 'done', 'done'),
        facts: [
          { id: 'f-wrong', label: 'Fehlannahme', value: '„main zeigt meine Version“' },
          { id: 'f-right', label: 'Richtig', value: 'Tag oder release/x.0 deiner Runtime lesen' },
        ],
      },
      changed: ['f-wrong', 'f-right'],
      explanation:
        'Häufige Fehlannahme: „Was auf GitHub in `main` steht, läuft auf meinem Rechner.“ Wer mit .NET 9 arbeitet und `main` liest, sucht nach einem FCall, den es dort nicht mehr gibt, oder umgekehrt. Lies immer den Tag oder Release-Zweig deiner Runtime-Version.',
    },
  ],
});
