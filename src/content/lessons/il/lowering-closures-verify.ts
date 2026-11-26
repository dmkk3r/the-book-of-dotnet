// Code samples for the VerifyCard in lowering-closures.mdx. They live here because Prettier
// strips the indentation of template literals inside MDX props.

export const sharplabCode = `using System;

public class C
{
    private int _factor = 3;

    public Func<int, int> NoCapture() => x => x * 2;

    public Func<int, int> CaptureThis() => x => x * _factor;

    public Func<int, int> CaptureLocal(int offset) => x => x + offset;

    public Func<int, int> MethodGroup() => Twice;

    public int LocalFunction(int offset)
    {
        return Add(1) + Add(2);

        int Add(int x) => x + offset;
    }

    private static int Twice(int x) => x * 2;
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class ClosureBench
{
    private int _factor = 3;

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Apply(Func<int, int> f, int x) => f(x);

    [Benchmark(Baseline = true)]
    public int NoCapture() => Apply(static x => x * 2, 21);

    [Benchmark]
    public int CaptureThis() => Apply(x => x * _factor, 21);

    [Benchmark]
    public int CaptureLocal()
    {
        int f = _factor;
        return Apply(x => x * f, 21);
    }

    [Benchmark]
    public int LocalFunction()
    {
        int f = _factor;
        return Mul(21);

        int Mul(int x) => x * f;
    }
}`;

// IL of the cached delegate for a lambda without closure (shown in the lesson text).
// TODO(verify): Exact IL in SharpLab (Release), including offsets and generated names.
export const cachedDelegateIl = `IL_0000: ldsfld class [System.Runtime]System.Func\`2<int32, int32> C/'<>c'::'<>9__0_0'
IL_0005: dup
IL_0006: brtrue.s IL_001f
IL_0008: pop
IL_0009: ldsfld class C/'<>c' C/'<>c'::'<>9'
IL_000e: ldftn instance int32 C/'<>c'::'<NoCapture>b__0_0'(int32)
IL_0014: newobj instance void class [System.Runtime]System.Func\`2<int32, int32>::.ctor(object, native int)
IL_0019: dup
IL_001a: stsfld class [System.Runtime]System.Func\`2<int32, int32> C/'<>c'::'<>9__0_0'
IL_001f: ret`;
