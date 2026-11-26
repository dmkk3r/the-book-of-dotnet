// Code samples for the VerifyCard in ref-struct.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Diagnostics.CodeAnalysis;

public ref struct Counter
{
    private ref int _count;                       // ref-Feld (C# 11)
    public Counter(ref int count) => _count = ref count;
    public void Increment() => _count++;
}

public struct Holder
{
    private int _value;
    [UnscopedRef] public ref int Value => ref _value;  // ohne Attribut: Fehler
}

public static class Demo
{
    public static Span<int> FromStack()
    {
        Span<int> s = stackalloc int[3];
        return s;                                 // Fehler erwartet
    }

    public static Span<int> PassScoped(scoped Span<int> s) => s; // Fehler erwartet

    public static void Copy(ref Span<int> target, Span<int> source) => target = source;

    public static void Caller()
    {
        Span<int> heap = new int[4];
        Span<int> stack = stackalloc int[4];
        Copy(ref heap, stack);                    // Fehler erwartet
    }

    public static int Use()
    {
        int n = 0;
        var c = new Counter(ref n);
        c.Increment();
        c.Increment();
        return n;                                 // 2
    }
}`;
