// Code samples for the VerifyCard in inlining.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const inliningCode = `using System.Runtime.CompilerServices;

static class Program
{
    static int Square(int x) => x * x;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static int SquareNoInline(int x) => x * x;

    // AggressiveOptimization: sofort optimiert, denn Tier 0 bettet nichts ein
    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int Compute() => Square(7) + 1;

    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int ComputeNoInline() => SquareNoInline(7) + 1;

    static int Fail(int x) => x > 0 ? throw new InvalidOperationException("x") : x;

    [MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
    static int CallsFail(int x) => Fail(x) + 1;

    static void Main()
    {
        Console.WriteLine(Compute() + ComputeNoInline());
        try { CallsFail(1); }
        catch (Exception e) { Console.WriteLine(e.StackTrace); }
    }
}

// In SharpLab („JIT Asm“, Release) oder lokal:
// DOTNET_JitDisasm="Compute ComputeNoInline" dotnet run -c Release
// Fehlt Fail im Stacktrace, wurde es in CallsFail eingebettet.`;

export const benchmarkCode = `public class InliningBench
{
    private int _x = 7;

    [Benchmark(Baseline = true)]
    public int Inlined() => Square(_x) + 1;

    [Benchmark]
    public int NotInlined() => SquareNoInline(_x) + 1;

    [Benchmark]
    public int SumInlined()
    {
        int sum = 0;
        for (int i = 0; i < 1000; i++) sum += Square(i);
        return sum;
    }

    [Benchmark]
    public int SumNotInlined()
    {
        int sum = 0;
        for (int i = 0; i < 1000; i++) sum += SquareNoInline(i);
        return sum;
    }

    private static int Square(int x) => x * x;

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int SquareNoInline(int x) => x * x;
}`;
