// Code samples for the VerifyCard in stackalloc.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System;
using System.Runtime.CompilerServices;

public static class C
{
    public static int Hex(int value)
    {
        Span<char> buf = stackalloc char[8];
        value.TryFormat(buf, out int written, "X");
        return written;
    }

    public static int Dynamic(int n)
    {
        Span<byte> buf = stackalloc byte[n];
        buf.Fill(1);
        return buf[^1];
    }

    [SkipLocalsInit]
    public static int NoInit(int n)
    {
        Span<byte> buf = stackalloc byte[n];
        return buf[0]; // undefinierter Inhalt
    }
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class StackallocBench
{
    private int _value = 0x7FEDCBA9;

    [Benchmark(Baseline = true)]
    public int Heap()
    {
        char[] buf = new char[16];
        _value.TryFormat(buf, out int written, "X");
        return written;
    }

    [Benchmark]
    public int Stack()
    {
        Span<char> buf = stackalloc char[16];
        _value.TryFormat(buf, out int written, "X");
        return written;
    }

    [Benchmark]
    public int Stack16K()
    {
        Span<byte> buf = stackalloc byte[16 * 1024];
        buf[0] = 1;
        return buf[0];
    }

    [Benchmark, SkipLocalsInit] // braucht <AllowUnsafeBlocks>true</AllowUnsafeBlocks>
    public int Stack16KNoInit()
    {
        Span<byte> buf = stackalloc byte[16 * 1024];
        buf[0] = 1;
        return buf[0];
    }
}`;
