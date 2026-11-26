// Code samples for the VerifyCard in simd.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const simdCode = `using System.Numerics;
using System.Runtime.Intrinsics;
using System.Runtime.Intrinsics.X86;
using System.Runtime.Intrinsics.Arm;

Console.WriteLine($"Vector<int>.Count:         {Vector<int>.Count}");
Console.WriteLine($"Vector.IsHardwareAccel.:   {Vector.IsHardwareAccelerated}");
Console.WriteLine($"Vector128 beschleunigt:    {Vector128.IsHardwareAccelerated}");
Console.WriteLine($"Vector256 beschleunigt:    {Vector256.IsHardwareAccelerated}");
Console.WriteLine($"Vector512 beschleunigt:    {Vector512.IsHardwareAccelerated}");
Console.WriteLine($"Avx2.IsSupported:          {Avx2.IsSupported}");
Console.WriteLine($"Avx512F.IsSupported:       {Avx512F.IsSupported}");
Console.WriteLine($"AdvSimd.IsSupported:       {AdvSimd.IsSupported}");

// Danach dasselbe mit abgeschalteten Befehlssätzen (Namen gelten ab .NET 10):
// DOTNET_EnableAVX512=0 dotnet run -c Release
// DOTNET_EnableAVX2=0 dotnet run -c Release
// DOTNET_EnableHWIntrinsic=0 dotnet run -c Release
// Den Maschinencode einer Methode zeigt:
// DOTNET_JitDisasm="SumVector128" dotnet run -c Release`;

export const benchmarkCode = `public class SumBench
{
    private int[] _data = null!;

    [Params(8, 1024, 1_000_000)]
    public int N;

    [GlobalSetup]
    public void Setup() => _data = Enumerable.Range(0, N).ToArray();

    [Benchmark(Baseline = true)]
    public int Scalar()
    {
        int sum = 0;
        foreach (int x in _data) sum += x;
        return sum;
    }

    [Benchmark]
    public int SumVector128()
    {
        ReadOnlySpan<int> data = _data;
        var acc = Vector128<int>.Zero;
        int i = 0;
        for (; i <= data.Length - Vector128<int>.Count; i += Vector128<int>.Count)
            acc += Vector128.Create(data.Slice(i));
        int sum = Vector128.Sum(acc);
        for (; i < data.Length; i++) sum += data[i];
        return sum;
    }

    [Benchmark]
    public int SumVectorT()
    {
        ReadOnlySpan<int> data = _data;
        var acc = Vector<int>.Zero;
        int i = 0;
        for (; i <= data.Length - Vector<int>.Count; i += Vector<int>.Count)
            acc += new Vector<int>(data.Slice(i));
        int sum = Vector.Sum(acc);
        for (; i < data.Length; i++) sum += data[i];
        return sum;
    }
}`;
