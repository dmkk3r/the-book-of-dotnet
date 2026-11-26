// Code samples for the VerifyCards in native-aot.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Expected output on .NET 8+: IsDynamicCodeSupported True/False, Type.GetType result,
// warning IL2057 at publish, and that the dotnet new console --aot template sets
// InvariantGlobalization.

export const aotCompareCode = `using System.Diagnostics;
using System.Runtime.CompilerServices;

var sinceStart = DateTime.Now - Process.GetCurrentProcess().StartTime;
Console.WriteLine($"Main nach:         {sinceStart.TotalMilliseconds:F0} ms");
Console.WriteLine($"Dynamischer Code:  {RuntimeFeature.IsDynamicCodeSupported}");
Console.WriteLine($"Working Set:       {Environment.WorkingSet / 1024 / 1024} MB");

string name = args.FirstOrDefault() ?? "";
Type? t = Type.GetType(name);
Console.WriteLine($"Type.GetType({name}): {t?.FullName ?? "null"}");

class Report { public void Print() => Console.WriteLine("Bericht"); }

// Projekt anlegen: dotnet new console --aot
// 1. dotnet run -c Release -- Report             (JIT)
// 2. dotnet publish -c Release -r linux-x64       (Native AOT, RID anpassen)
//    und bin/Release/net*/linux-x64/publish/<Projektname> Report starten
// Beim Veröffentlichen auf die Warnungen in der Ausgabe achten.`;

export const aotSizeCode = `# Größe und Inhalt vergleichen (Linux, macOS)
ls -lh bin/Release/net*/linux-x64/publish/

# Statt Datei-Ordner: eine Programmdatei und eine Symboldatei (.dbg)
# Optional: Größenbericht des Compilers erzeugen
dotnet publish -c Release -r linux-x64 -p:IlcGenerateMstatFile=true`;
