// Code samples for the VerifyCard in bounds-checks.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const boundsCode = `public static class Demo
{
    // Muster: i < a.Length, kein Bounds-Check im Rumpf
    public static int Sum(int[] a)
    {
        int sum = 0;
        for (int i = 0; i < a.Length; i++) sum += a[i];
        return sum;
    }

    // Grenze aus einem Parameter: Prüfung bleibt (oder Loop Cloning)
    public static int SumN(int[] a, int n)
    {
        int sum = 0;
        for (int i = 0; i < n; i++) sum += a[i];
        return sum;
    }

    // Grenze über einen Slice mitteilen: wieder ohne Prüfung
    public static int SumSpan(int[] a, int n)
    {
        ReadOnlySpan<int> s = a.AsSpan(0, n);
        int sum = 0;
        for (int i = 0; i < s.Length; i++) sum += s[i];
        return sum;
    }

    // Eine Prüfung vorziehen: danach sind a[0] bis a[3] bewiesen
    public static int First4(int[] a)
    {
        _ = a[3];
        return a[0] + a[1] + a[2] + a[3];
    }

    // Eigene Prüfung im Stil der Runtime
    public static int GetOrZero(int[] a, int i)
        => (uint)i < (uint)a.Length ? a[i] : 0;
}

// Lokal: DOTNET_JitDisasm="Sum SumN SumSpan First4 GetOrZero" dotnet run -c Release
// Ein Bounds-Check ist ein cmp mit [reg+0x08] (Länge) und ein jae
// zu einem Block mit CORINFO_HELP_RNGCHKFAIL.`;

export const benchmarkCode = `public class BoundsBench
{
    private int[] _data = Enumerable.Range(0, 4096).ToArray();
    private int _n = 4096;

    [Benchmark(Baseline = true)]
    public int ToLength()
    {
        int[] a = _data;
        int sum = 0;
        for (int i = 0; i < a.Length; i++) sum += a[i];
        return sum;
    }

    [Benchmark]
    public int ToLocalN()
    {
        int[] a = _data;
        int n = _n;
        int sum = 0;
        for (int i = 0; i < n; i++) sum += a[i];   // Kandidat für Loop Cloning
        return sum;
    }

    [Benchmark]
    public int ViaSpanSlice()
    {
        ReadOnlySpan<int> s = _data.AsSpan(0, _n);
        int sum = 0;
        for (int i = 0; i < s.Length; i++) sum += s[i];
        return sum;
    }
}`;
