// Code samples for the VerifyCard and the examples in asm-lesen.mdx. They live here because
// Prettier strips the indentation of template literals inside MDX props.

export const sharplabCode = `using System.Runtime.CompilerServices;

public static class C
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int Get(int[] a, int i) => a[i];

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int SumAll(int[] a)
    {
        int sum = 0;
        for (int i = 0; i < a.Length; i++)
            sum += a[i];
        return sum;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void Store(Node n, object value) => n.Value = value;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static Node Create() => new Node();

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static bool IsLeaf(object o) => o is Leaf;
}

public class Node { public object? Value; }
public sealed class Leaf { }`;

export const benchmarkCode = `[DisassemblyDiagnoser(maxDepth: 1)]
public class AsmBench
{
    private readonly int[] _data = Enumerable.Range(0, 1_000).ToArray();

    [Benchmark]
    public int SumFor()
    {
        int sum = 0;
        for (int i = 0; i < _data.Length; i++)
            sum += _data[i];
        return sum;
    }

    [Benchmark]
    public int SumLinq() => _data.Sum();
}`;

// TODO(verify): All three snippets against real JitDisasm output (.NET 8+, Windows x64): helper
// names, the register for the field address and value, and whether the type check tests for null
// first. MethodTable constants are fictitious.
export const patternsCode = `; Allokation: new Node()
mov      rcx, 0x7FF8A1B2C3D0      ; MethodTable von Node
call     CORINFO_HELP_NEWSFAST    ; neues Objekt, Verweis kommt in rax zurück

; Verweis in ein Feld schreiben: n.Value = value
lea      rcx, bword ptr [rcx+0x08] ; Adresse des Feldes Value
call     CORINFO_HELP_ASSIGN_REF   ; speichert rdx dort, pflegt bei Bedarf die Card Table

; Typprüfung: o is Leaf (Leaf ist sealed)
xor      eax, eax
test     rcx, rcx                 ; null ist nie ein Leaf
je       SHORT G_M000_IG04
mov      rdx, 0x7FF8A1B2D4E0      ; MethodTable von Leaf
cmp      qword ptr [rcx], rdx     ; erstes Feld jedes Objekts: seine MethodTable
sete     al`;
