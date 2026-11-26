// Benchmark for the VerifyCard in exception-kosten.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Relative results on .NET 8 versus .NET 9/10 (x64): TryParse and the try block
// without a throw in the same range as the baseline; ParseCatch several orders of magnitude
// slower; Depth20 clearly slower than Depth1; .NET 9 faster than .NET 8 for all throwing
// benchmarks. Allocations of the throwing benchmarks (exception object plus stack trace data)
// were not measured.

export const benchmarkCode = `[MemoryDiagnoser]
public class ExceptionCost
{
    private readonly string _bad = "abc";
    private readonly string _good = "42";

    [Benchmark(Baseline = true)]
    public int TryParseBad() => int.TryParse(_bad, out var v) ? v : -1;

    [Benchmark]
    public int ParseCatchBad()
    {
        try { return int.Parse(_bad); }
        catch (FormatException) { return -1; }
    }

    [Benchmark]
    public int ParseInTryGood()
    {
        try { return int.Parse(_good); }      // try ohne Wurf
        catch (FormatException) { return -1; }
    }

    [Benchmark]
    public int ParseGood() => int.Parse(_good); // ohne try

    [Benchmark]
    public int Depth1() => Catch(1);

    [Benchmark]
    public int Depth20() => Catch(20);

    private static int Catch(int depth)
    {
        try { return Recurse(depth); }
        catch (InvalidOperationException) { return -1; }
    }

    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int Recurse(int depth) =>
        depth == 0 ? throw new InvalidOperationException() : Recurse(depth - 1) + 1;
}

// Zum Vergleich der Versionen in der Main-Methode:
// BenchmarkRunner.Run<ExceptionCost>(DefaultConfig.Instance
//     .AddJob(Job.Default.WithRuntime(CoreRuntime.Core80))
//     .AddJob(Job.Default.WithRuntime(CoreRuntime.Core90)));`;
