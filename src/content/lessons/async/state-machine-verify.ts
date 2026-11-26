// Code samples for the VerifyCard in state-machine.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `using System.Threading.Tasks;

public class C
{
    public async Task<int> SumAsync(Task<int> fast, Task<int> slow)
    {
        int a = await fast;
        int b = await slow;
        return a + b;
    }
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class AsyncBench
{
    [Benchmark] public async Task Sync() { await Task.CompletedTask; }

    [Benchmark] public async Task<int> SyncInt()
    {
        await Task.CompletedTask;
        return 1000;
    }

    [Benchmark] public async Task Yielding() { await Task.Yield(); }
}`;
