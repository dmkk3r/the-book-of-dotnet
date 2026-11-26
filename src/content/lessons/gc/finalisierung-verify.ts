// Code samples for the VerifyCards in finalisierung.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const lifecycleCode = `using System.Runtime.CompilerServices;

class Tracked
{
    ~Tracked() => Console.WriteLine("Finalizer läuft");
}

static class Program
{
    static WeakReference s_short = null!;
    static WeakReference s_long = null!;

    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Create()
    {
        var t = new Tracked();
        s_short = new WeakReference(t, trackResurrection: false);
        s_long = new WeakReference(t, trackResurrection: true);
    }

    static void Main()
    {
        Create();
        GC.Collect();
        Console.WriteLine($"nach 1. GC: kurz={s_short.IsAlive}, lang={s_long.IsAlive}");
        GC.WaitForPendingFinalizers();
        GC.Collect();
        Console.WriteLine($"nach 2. GC: kurz={s_short.IsAlive}, lang={s_long.IsAlive}");
    }
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class FinalizerCost
{
    sealed class Plain { public int X; }

    sealed class WithFinalizer
    {
        public int X;
        ~WithFinalizer() { }
    }

    [Benchmark(Baseline = true)]
    public object AllocPlain() => new Plain();

    [Benchmark]
    public object AllocWithFinalizer() => new WithFinalizer();
}`;
