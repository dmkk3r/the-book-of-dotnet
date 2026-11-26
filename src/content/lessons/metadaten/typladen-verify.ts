// Code samples for the VerifyCards in typladen.mdx. They live here because Prettier strips the
// indentation of template literals inside MDX props.
// TODO(verify): Run both programs as console apps (net8.0, dotnet run -c Release) and record the
// output. Expected for lazyLoadCode: "[geladen] System.Text.RegularExpressions" appears after
// "2. Rufe UseRegex auf" and before "3. UseRegex läuft"; other assemblies (for example System.Linq)
// may show up as well. Expected for cctorCode: "[Praezise initialisiert]" before
// "Praezise.Hallo", "[Lax initialisiert]" only before "Lax.Wert" (possibly earlier, beforefieldinit
// allows it), "[Kaputt.cctor läuft]" exactly once, "Absicht" twice.

export const lazyLoadCode = `using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

AppDomain.CurrentDomain.AssemblyLoad += (_, e) =>
    Console.WriteLine($"  [geladen] {e.LoadedAssembly.GetName().Name}");

Console.WriteLine("1. Main läuft");
Console.WriteLine($"   Regex-Assembly geladen? {IsLoaded("System.Text.RegularExpressions")}");
Console.WriteLine("2. Rufe UseRegex auf");
UseRegex();
Console.WriteLine("4. Fertig");

static bool IsLoaded(string name) =>
    AppDomain.CurrentDomain.GetAssemblies().Any(a => a.GetName().Name == name);

// NoInlining, damit UseRegex eine eigene Methode bleibt und erst
// beim ersten Aufruf übersetzt wird
[MethodImpl(MethodImplOptions.NoInlining)]
static void UseRegex()
{
    Console.WriteLine("3. UseRegex läuft");
    Console.WriteLine(Regex.IsMatch("abc", "b"));
}`;

export const cctorCode = `Console.WriteLine("Start");
Console.WriteLine($"Praezise.Hallo: {Praezise.Hallo()}");
Console.WriteLine($"Lax.Hallo:      {Lax.Hallo()}");
Console.WriteLine($"Lax.Wert:       {Lax.Wert}");

for (int i = 1; i <= 2; i++)
{
    try { _ = Kaputt.Wert; }
    catch (TypeInitializationException e)
    {
        Console.WriteLine($"{i}. Versuch: {e.InnerException?.Message}");
    }
}

static class Log
{
    public static int Write(string s) { Console.WriteLine($"  [{s}]"); return 1; }
}

class Praezise
{
    public static int Wert = Log.Write("Praezise initialisiert");
    static Praezise() { }   // explizit: präzise Semantik
    public static string Hallo() => "hallo";
}

class Lax                   // kein statischer Konstruktor: beforefieldinit
{
    public static int Wert = Log.Write("Lax initialisiert");
    public static string Hallo() => "hallo";
}

class Kaputt
{
    public static int Wert = Wirf();
    static int Wirf()
    {
        Console.WriteLine("  [Kaputt.cctor läuft]");
        throw new InvalidOperationException("Absicht");
    }
}`;
