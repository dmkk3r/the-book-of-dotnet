// Code samples for the VerifyCard in gc-konfiguration.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const probeCode = `using System.Runtime;

var info = GC.GetGCMemoryInfo();
Console.WriteLine($"IsServerGC:            {GCSettings.IsServerGC}");
Console.WriteLine($"LatencyMode:           {GCSettings.LatencyMode}");
Console.WriteLine($"ProcessorCount:        {Environment.ProcessorCount}");
Console.WriteLine($"TotalAvailableMemory:  {info.TotalAvailableMemoryBytes / 1024 / 1024} MiB");
Console.WriteLine($"runtimeconfig Server:  {AppContext.GetData("System.GC.Server") ?? "nicht gesetzt"}");

// Seit .NET 7: die Werte, mit denen der GC tatsächlich arbeitet
foreach (var (name, value) in GC.GetConfigurationVariables())
{
    if (name.Contains("HeapHardLimit") || name.Contains("HeapCount") || name == "ServerGC")
        Console.WriteLine($"  {name} = {value}");
}`;
