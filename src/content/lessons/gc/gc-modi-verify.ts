// Code sample for the VerifyCard in gc-modi.mdx. It lives here because Prettier strips the
// indentation of template literals inside MDX props.
// TODO(verify): Key names returned by GC.GetConfigurationVariables() ("ServerGC", "HeapCount",
// "ConcurrentGC", "GCDynamicAdaptationMode") on .NET 8/9; printed generically to avoid guessing.

export const verifyCode = `using System.Runtime;

Console.WriteLine($"Server GC: {GCSettings.IsServerGC}, Kerne: {Environment.ProcessorCount}");
foreach (var (key, value) in GC.GetConfigurationVariables())
    Console.WriteLine($"  {key} = {value}");

// Langlebige Daten (etwa 100 MB) plus viele kurzlebige Allokationen auf allen Kernen
var keep = new List<byte[]>();
for (int i = 0; i < 100; i++) keep.Add(new byte[1_000_000]);

Parallel.For(0, Environment.ProcessorCount, _ =>
{
    var sink = new object[1];
    for (int i = 0; i < 20_000_000; i++) sink[0] = new byte[100];
});

var info = GC.GetGCMemoryInfo();
Console.WriteLine($"Gen0-Collections: {GC.CollectionCount(0)}");
Console.WriteLine($"Committed: {info.TotalCommittedBytes / 1_000_000} MB");
Console.WriteLine($"Working Set: {Environment.WorkingSet / 1_000_000} MB");
GC.KeepAlive(keep);`;
