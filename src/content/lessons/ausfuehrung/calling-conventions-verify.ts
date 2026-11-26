// Code samples for the VerifyCard in calling-conventions.mdx. They live here because Prettier
// strips the indentation of template literals inside MDX props.
// TODO(verify): Expected listings on SharpLab (x64, Release, Windows ABI) and the benchmark
// results for passing a 64-byte struct by value versus by `in` on .NET 8+ x64 and ARM64.

export const sharplabCode = `using System.Runtime.CompilerServices;

public struct Point3 { public double X, Y, Z; }   // 24 Byte
public struct Small { public int A, B; }          // 8 Byte

public class Mover
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public Point3 Move(Point3 p, double f, int n)
    {
        p.X += f * n;
        return p;
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int Sum5(int a, int b, int c, int d, int e) => a + b + c + d + e;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int First(Small s) => s.A;

    public static Point3 Caller(Mover m, Point3 o) => m.Move(o, 1.5, 7);
    public static int Caller2() => Sum5(1, 2, 3, 4, 5) + First(new Small { A = 1, B = 2 });
}`;

export const benchmarkCode = `public struct Big { public long A, B, C, D, E, F, G, H; }   // 64 Byte

[MemoryDiagnoser]
[DisassemblyDiagnoser]
public class StructPassing
{
    private Big _big = new() { A = 1, H = 8 };

    [Benchmark(Baseline = true)]
    public long ByValue() => TakeValue(_big);

    [Benchmark]
    public long ByIn() => TakeIn(in _big);

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static long TakeValue(Big b) => b.A + b.H;

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static long TakeIn(in Big b) => b.A + b.H;
}`;
