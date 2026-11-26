// Code samples for the VerifyCard in unsafe-api.mdx. They live here because Prettier strips the
// indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

var h = new Header { Version = 1, Flags = 0x80, Length = 258 };
Console.WriteLine(Unsafe.SizeOf<Header>());          // Größe mit Padding

Span<byte> bytes = MemoryMarshal.AsBytes(new Span<Header>(ref h));
Console.WriteLine(Convert.ToHexString(bytes));       // Byte 3 ist Padding
bytes[5] = 0x02;
Console.WriteLine(h.Length);                         // dieselben Bytes

Span<int> ints = MemoryMarshal.Cast<byte, int>(bytes);
Console.WriteLine(ints.Length);

var list = new List<int>(4) { 1, 2, 3, 4 };
Span<int> span = CollectionsMarshal.AsSpan(list);
list.Add(5);                                         // neues Array
span[1] = 20;
Console.WriteLine(list[1]);                          // alte Sicht

struct Header { public ushort Version; public byte Flags; public int Length; }`;

export const benchmarkCode = `[MemoryDiagnoser]
public class MarshalBench
{
    private readonly List<int> _list = Enumerable.Range(0, 1000).ToList();
    private readonly string[] _words =
        Enumerable.Range(0, 1000).Select(i => "w" + (i % 50)).ToArray();
    private readonly Dictionary<string, int> _counts = new();

    [Benchmark(Baseline = true)]
    public int SumIndexer()
    {
        int sum = 0;
        for (int i = 0; i < _list.Count; i++) sum += _list[i];
        return sum;
    }

    [Benchmark]
    public int SumAsSpan()
    {
        int sum = 0;
        foreach (int x in CollectionsMarshal.AsSpan(_list)) sum += x;
        return sum;
    }

    [Benchmark]
    public void CountTwoLookups()
    {
        _counts.Clear();
        foreach (string w in _words)
            _counts[w] = _counts.TryGetValue(w, out int c) ? c + 1 : 1;
    }

    [Benchmark]
    public void CountOneLookup()
    {
        _counts.Clear();
        foreach (string w in _words)
            CollectionsMarshal.GetValueRefOrAddDefault(_counts, w, out _)++;
    }
}`;
