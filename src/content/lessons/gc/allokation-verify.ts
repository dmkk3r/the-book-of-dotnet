// Code samples for the VerifyCard in allokation.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const measureCode = `static long Measure(string label, Action action)
{
    action(); // einmal vorab, damit JIT und statische Initialisierung nicht mitzählen
    long before = GC.GetAllocatedBytesForCurrentThread();
    action();
    long bytes = GC.GetAllocatedBytesForCurrentThread() - before;
    Console.WriteLine($"{label}: {bytes} B");
    return bytes;
}

int value = 50;
object sink = null!;

Measure("new object()", () => sink = new object());
Measure("Boxing", () => sink = value);
Measure("String-Verkettung", () => sink = "Wert: " + value);
Measure("int[1000]", () => sink = new int[1000]);
Measure("byte[100_000] (LOH)", () => sink = new byte[100_000]);
GC.KeepAlive(sink);`;

export const benchmarkCode = `[MemoryDiagnoser]
public class HiddenAllocations
{
    private readonly int[] _data = Enumerable.Range(0, 100).ToArray();
    private int _threshold = 50;

    [Benchmark(Baseline = true)]
    public int Loop()
    {
        int n = 0;
        foreach (var x in _data)
            if (x > _threshold) n++;
        return n;
    }

    [Benchmark]
    public int Linq() => _data.Count(x => x > _threshold);

    [Benchmark]
    public object Box() => _threshold;

    [Benchmark]
    public string Concat() => "Wert: " + _threshold;
}`;
