// Code samples for the VerifyCards in start-vs-durchsatz.mdx. They live here because Prettier
// strips the indentation of template literals inside MDX props.
// TODO(verify): System.Runtime.JitInfo (GetCompiledMethodCount, GetCompilationTime) exists since
// .NET 6 and returns 0 under Native AOT.
// TODO(verify): BenchmarkDotNet API names: Job.WithEnvironmentVariables, EnvironmentVariable,
// NativeAotRuntime.Net80, and that a Native AOT job needs the ILCompiler package restore to work.

export const startupCode = `// Program.cs einer Konsolen-App. Starte sie in mehreren Varianten:
//   dotnet run -c Release
//   DOTNET_TieredCompilation=0 dotnet run -c Release
//   DOTNET_ReadyToRun=0 dotnet run -c Release
//   dotnet publish -c Release -r linux-x64 -p:PublishReadyToRun=true
//   dotnet publish -c Release -r linux-x64 -p:PublishAot=true
using System.Diagnostics;
using System.Runtime;

Report("Main erreicht");

var words = Enumerable.Range(0, 10_000)
    .Select(i => $"wort{i % 500}")
    .GroupBy(w => w)
    .ToDictionary(g => g.Key, g => g.Count());
Report($"Erste Arbeit erledigt ({words.Count} Gruppen)");

static void Report(string label)
{
    double ms = (DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;
    Console.WriteLine(
        $"{label}: {ms:F0} ms seit Prozessstart, " +
        $"{JitInfo.GetCompiledMethodCount()} Methoden vom JIT, " +
        $"{JitInfo.GetCompilationTime().TotalMilliseconds:F0} ms im JIT");
}`;

export const benchmarkCode = `[Config(typeof(Variants))]
public class SteadyState
{
    private class Variants : ManualConfig
    {
        public Variants()
        {
            AddJob(Job.Default.WithId("JIT Standard"));
            AddJob(Job.Default.WithId("ohne PGO")
                .WithEnvironmentVariables(new EnvironmentVariable("DOTNET_TieredPGO", "0")));
            AddJob(Job.Default.WithId("Tiering aus")
                .WithEnvironmentVariables(new EnvironmentVariable("DOTNET_TieredCompilation", "0")));
            AddJob(Job.Default.WithId("Native AOT").WithRuntime(NativeAotRuntime.Net80));
        }
    }

    private IShape[] _shapes = null!;

    [GlobalSetup]
    public void Setup() =>
        _shapes = Enumerable.Range(0, 1000)
            .Select(i => i % 10 == 0 ? (IShape)new Square(i) : new Circle(i))
            .ToArray();

    [Benchmark]
    public double TotalArea()
    {
        double sum = 0;
        foreach (var s in _shapes) sum += s.Area();
        return sum;
    }
}

public interface IShape { double Area(); }
public sealed class Circle(double r) : IShape { public double Area() => Math.PI * r * r; }
public sealed class Square(double a) : IShape { public double Area() => a * a; }`;
