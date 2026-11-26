// Code samples for the VerifyCard in stack-walking.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Expected output of the sample in Release and Debug builds on .NET 8+ (whether
// Validate appears, whether Hidden is left out) and the relative cost of the benchmarks.

export const traceCode = `using System.Diagnostics;
using System.Runtime.CompilerServices;

Process("");

static void Process(string s)
{
    try { Validate(s); }
    catch (ArgumentException ex) { Console.WriteLine(ex.StackTrace); }

    Hidden();
    Log("fertig");
}

static void Validate(string s)
{
    if (s.Length == 0) throw new ArgumentException("leer");
}

[StackTraceHidden]
static void Hidden() => Console.WriteLine(new StackTrace(fNeedFileInfo: true));

static void Log(string msg, [CallerMemberName] string member = "",
                [CallerLineNumber] int line = 0)
    => Console.WriteLine($"{member}:{line} {msg}");`;

export const benchmarkCode = `[MemoryDiagnoser]
public class CallerInfo
{
    [Benchmark(Baseline = true)]
    public string CallerMember() => Who();

    [Benchmark]
    public string StackTraceFrame() => new StackTrace().GetFrame(0)!.GetMethod()!.Name;

    [Benchmark]
    public string StackTraceWithFiles() => new StackTrace(true).ToString();

    [Benchmark]
    public string EnvironmentStackTrace() => Environment.StackTrace;

    private static string Who([CallerMemberName] string name = "") => name;
}`;
