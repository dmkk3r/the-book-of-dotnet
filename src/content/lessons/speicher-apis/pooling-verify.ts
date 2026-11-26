// Code samples for the VerifyCard in pooling.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Buffers;

var pool = ArrayPool<byte>.Shared;

foreach (int n in new[] { 1, 16, 17, 100, 1000, 4097 })
{
    byte[] a = pool.Rent(n);
    Console.WriteLine($"Rent({n}) -> Length {a.Length}");
    pool.Return(a);
}

byte[] x = pool.Rent(100);
pool.Return(x);
byte[] y = pool.Rent(120);
Console.WriteLine($"Dasselbe Array: {ReferenceEquals(x, y)}");
pool.Return(y);

try
{
    pool.Return(new byte[100]);
}
catch (ArgumentException e)
{
    Console.WriteLine($"Fremdes Array: {e.GetType().Name}");
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class PoolBench
{
    [Params(64, 128 * 1024)]
    public int Size;

    [Benchmark(Baseline = true)]
    public byte New()
    {
        byte[] buf = new byte[Size];
        buf[0] = 1;
        return buf[Size - 1];
    }

    [Benchmark]
    public byte Pooled()
    {
        byte[] buf = ArrayPool<byte>.Shared.Rent(Size);
        buf[0] = 1;
        byte last = buf[Size - 1];
        ArrayPool<byte>.Shared.Return(buf);
        return last;
    }
}`;
