// Code samples for the VerifyCard in iteratoren.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Collections.Generic;
using System.IO;

public static class C
{
    public static IEnumerable<int> Range(int start, int count)
    {
        for (int i = 0; i < count; i++)
            yield return start + i;
    }

    public static IEnumerable<string> Lines(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        using var reader = new StreamReader(path);
        while (reader.ReadLine() is string line)
            yield return line;
    }

    public static IEnumerable<string> LinesChecked(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        return Core(path);

        static IEnumerable<string> Core(string path)
        {
            using var reader = new StreamReader(path);
            while (reader.ReadLine() is string line)
                yield return line;
        }
    }
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class IteratorBench
{
    private static IEnumerable<int> Range(int start, int count)
    {
        for (int i = 0; i < count; i++)
            yield return start + i;
    }

    [Benchmark(Baseline = true)]
    public int Loop()
    {
        int s = 0;
        for (int i = 0; i < 100; i++) s += i;
        return s;
    }

    [Benchmark]
    public int Iterator()
    {
        int s = 0;
        foreach (int x in Range(0, 100)) s += x;
        return s;
    }

    [Benchmark]
    public int IteratorTwice()
    {
        IEnumerable<int> seq = Range(0, 100);
        int s = 0;
        foreach (int x in seq) s += x;
        foreach (int x in seq) s += x;
        return s;
    }
}`;
