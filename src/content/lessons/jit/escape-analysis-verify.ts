// Code samples for the VerifyCard in escape-analysis.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const escapeCode = `using System.Runtime.CompilerServices;

sealed class Point
{
    public int X, Y;
    public Point(int x, int y) { X = x; Y = y; }
}

static class Program
{
    static Point? _last;

    // AggressiveOptimization: sofort optimiert, ohne Umweg über Tier 0
    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int Local(int x, int y)
    {
        var p = new Point(x, y);
        return p.X * p.X + p.Y * p.Y;
    }

    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int Stored(int x, int y)
    {
        var p = new Point(x, y);
        _last = p;
        return p.X;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Log(Point p) { }

    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int PassedOn(int x, int y)
    {
        var p = new Point(x, y);
        Log(p);
        return p.X;
    }

    static void Main()
    {
        Measure("Local", () => Local(3, 4));
        Measure("Stored", () => Stored(3, 4));
        Measure("PassedOn", () => PassedOn(3, 4));
    }

    static void Measure(string name, Func<int> f)
    {
        f();
        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++) f();
        long bytes = GC.GetAllocatedBytesForCurrentThread() - before;
        Console.WriteLine($"{name}: {bytes / 1000} B pro Aufruf");
    }
}

// Lokal, Release:
// DOTNET_JitDisasm="Local Stored PassedOn" dotnet run -c Release
// Vergleich ohne Stack-Allokation:
// DOTNET_JitObjectStackAllocation=0 dotnet run -c Release`;

export const benchmarkCode = `[MemoryDiagnoser]
public class EscapeBench
{
    private int _x = 3, _y = 4;
    private Point? _last;

    [Benchmark(Baseline = true)]
    public int Local()
    {
        var p = new Point(_x, _y);
        return p.X * p.X + p.Y * p.Y;
    }

    [Benchmark]
    public int Stored()
    {
        var p = new Point(_x, _y);
        _last = p;
        return p.X;
    }

    [Benchmark]
    public int PassedOn()
    {
        var p = new Point(_x, _y);
        Log(p);
        return p.X;
    }

    [Benchmark]
    public int SmallArray()
    {
        int[] a = { _x, _y, 5 };
        return a[0] + a[1] + a[2];
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void Log(Point p) { }
}`;
