// Code samples for the VerifyCard in pattern-matching.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;

public sealed class Circle { public double Radius { get; init; } }

public sealed class Money
{
    public decimal Amount { get; init; }
    public static bool operator ==(Money? a, Money? b) => true;   // absichtlich falsch
    public static bool operator !=(Money? a, Money? b) => false;
    public override bool Equals(object? o) => true;
    public override int GetHashCode() => 0;
}

public class C
{
    public double AreaOld(object o)
    {
        if (o is Circle) return ((Circle)o).Radius;
        return 0;
    }

    public double AreaNew(object o) => o is Circle c ? c.Radius : 0;

    public bool IsNullOperator(Money m) => m == null;
    public bool IsNullPattern(Money m) => m is null;

    public int Unbox(object o) => o is int i ? i : -1;

    public string Day(int d) => d switch
    {
        1 => "Mo", 2 => "Di", 3 => "Mi", 4 => "Do", 5 => "Fr",
        _ => "kein Werktag",
    };

    public int Color(string s) => s switch
    {
        "rot" => 1, "grün" => 2, "blau" => 3, "gelb" => 4,
        "weiß" => 5, "schwarz" => 6, "grau" => 7, "lila" => 8,
        _ => 0,
    };

    public int Rest(int[] a) => a is [_, .. var rest] ? rest.Length : -1;
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class ListPatternBench
{
    private readonly int[] _data = Enumerable.Range(0, 10).ToArray();

    [Benchmark(Baseline = true)]
    public int ArrayDiscard() => _data is [var first, ..] ? first : -1;

    [Benchmark]
    public int ArraySlice() => _data is [_, .. var rest] ? rest.Length : -1;

    [Benchmark]
    public int SpanSlice()
    {
        ReadOnlySpan<int> span = _data;
        return span is [_, .. var rest] ? rest.Length : -1;
    }
}`;
