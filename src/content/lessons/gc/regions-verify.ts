// Code sample for the VerifyCard in regions.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.

export const configCode = `foreach (var (key, value) in GC.GetConfigurationVariables())
{
    if (key.Contains("Region") || key is "ServerGC" or "ConcurrentGC")
        Console.WriteLine($"{key} = {value}");
}

var info = GC.GetGCMemoryInfo();
Console.WriteLine($"Committed: {info.TotalCommittedBytes / 1024} KB");
Console.WriteLine($"Heap:      {info.HeapSizeBytes / 1024} KB");

// Viel kurzlebigen Speicher anlegen und wieder loslassen
var keep = new List<byte[]>();
for (int i = 0; i < 20_000; i++) keep.Add(new byte[1000]);
keep = null;
GC.Collect();

info = GC.GetGCMemoryInfo();
Console.WriteLine($"Committed nach GC: {info.TotalCommittedBytes / 1024} KB");
Console.WriteLine($"Heap nach GC:      {info.HeapSizeBytes / 1024} KB");`;
