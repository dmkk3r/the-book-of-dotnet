// Code samples for start-bis-main.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): That Process.StartTime is available on Linux and macOS without extra permissions
// for the current process, and that its resolution is good enough for startup measurements.

export const hookCode = `// Hook.csproj: Klassenbibliothek, gleiche TargetFramework wie die App
// Kein Namespace, Name und Signatur sind fest vorgegeben
using System.Diagnostics;

internal class StartupHook
{
    public static void Initialize()
    {
        var seitStart = DateTime.Now - Process.GetCurrentProcess().StartTime;
        Console.WriteLine($"Hook nach {seitStart.TotalMilliseconds:F0} ms");
        Console.WriteLine($"Thread {Environment.CurrentManagedThreadId}");

        AppDomain.CurrentDomain.AssemblyLoad += (_, e) =>
            Console.WriteLine($"  geladen: {e.LoadedAssembly.GetName().Name}");
    }
}`;

export const timingCode = `using System.Diagnostics;

// Program.cs der App
var seitStart = DateTime.Now - Process.GetCurrentProcess().StartTime;
Console.WriteLine($"Main nach {seitStart.TotalMilliseconds:F0} ms");
Console.WriteLine($"Thread {Environment.CurrentManagedThreadId}");

// TickCount64 zählt seit dem Systemstart, nicht seit dem Prozessstart
Console.WriteLine($"TickCount64: {Environment.TickCount64} ms");

return args.Length;`;
