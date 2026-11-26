// Code samples for the VerifyCard in span.mdx. They live here because Prettier strips the
// indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Runtime.CompilerServices;

int[] arr = { 10, 20, 30, 40, 50, 60 };
Span<int> mid = arr.AsSpan(2, 3);

Console.WriteLine(Unsafe.SizeOf<Span<int>>());    // Größe des Span-Werts
Console.WriteLine(Unsafe.SizeOf<Memory<int>>());  // Größe des Memory-Werts
Console.WriteLine(Unsafe.ByteOffset(ref arr[0], ref mid[0])); // Abstand in Byte

mid[0] = 99;
Console.WriteLine(arr[2]);                        // dieselbe Speicherstelle

string text = "id=4711";
ReadOnlySpan<char> digits = text.AsSpan(3);
Console.WriteLine(int.Parse(digits));             // ohne Teilstring`;

export const benchmarkCode = `[MemoryDiagnoser]
public class SpanBench
{
    private readonly string _input = "12345,67890";
    private readonly int[] _data = Enumerable.Range(0, 1000).ToArray();
    private Memory<int> _memory;

    [GlobalSetup]
    public void Setup() => _memory = _data;

    [Benchmark(Baseline = true)]
    public int ParseSubstring()
    {
        int comma = _input.IndexOf(',');
        return int.Parse(_input.Substring(0, comma))
             + int.Parse(_input.Substring(comma + 1));
    }

    [Benchmark]
    public int ParseSpan()
    {
        ReadOnlySpan<char> s = _input;
        int comma = s.IndexOf(',');
        return int.Parse(s.Slice(0, comma)) + int.Parse(s.Slice(comma + 1));
    }

    [Benchmark]
    public int SumSpanOnce()
    {
        Span<int> span = _memory.Span;   // einmal auspacken
        int sum = 0;
        for (int i = 0; i < span.Length; i++) sum += span[i];
        return sum;
    }

    [Benchmark]
    public int SumMemorySpanEachTime()
    {
        int sum = 0;
        for (int i = 0; i < _memory.Length; i++) sum += _memory.Span[i];
        return sum;
    }
}`;
