// Code samples for the VerifyCard in lowering-schleifen.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Collections.Generic;
using System.Threading;

public class C
{
    public int SumArray(int[] a)
    {
        int s = 0;
        foreach (int x in a) s += x;
        return s;
    }

    public int SumList(List<int> l)
    {
        int s = 0;
        foreach (int x in l) s += x;
        return s;
    }

    public int SumSeq(IEnumerable<int> e)
    {
        int s = 0;
        foreach (int x in e) s += x;
        return s;
    }

    private readonly object _gate = new();
    private readonly Lock _lock = new();
    private int _count;

    public void WithMonitor() { lock (_gate) { _count++; } }
    public void WithLock()    { lock (_lock) { _count++; } }
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class ForeachBench
{
    private readonly int[] _array = Enumerable.Range(0, 100).ToArray();
    private readonly List<int> _list = Enumerable.Range(0, 100).ToList();
    private readonly IEnumerable<int> _seq = Enumerable.Range(0, 100).ToList();

    [Benchmark(Baseline = true)]
    public int ArrayFor()
    {
        int s = 0;
        for (int i = 0; i < _array.Length; i++) s += _array[i];
        return s;
    }

    [Benchmark]
    public int ArrayForeach()
    {
        int s = 0;
        foreach (int x in _array) s += x;
        return s;
    }

    [Benchmark]
    public int ListForeach()
    {
        int s = 0;
        foreach (int x in _list) s += x;
        return s;
    }

    [Benchmark]
    public int EnumerableForeach()
    {
        int s = 0;
        foreach (int x in _seq) s += x;
        return s;
    }
}`;
