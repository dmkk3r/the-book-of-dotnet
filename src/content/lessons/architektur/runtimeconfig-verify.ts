// Code samples for runtimeconfig.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Property names APP_CONTEXT_DEPS_FILES, FX_DEPS_FILE, RUNTIME_IDENTIFIER and
// PROBING_DIRECTORIES are readable via AppContext.GetData in .NET 8 and 9.

export const configCode = `using System.Globalization;
using System.Runtime;

// Was der Host übergeben hat
foreach (var key in new[]
{
    "System.GC.Server",
    "System.Globalization.Invariant",
    "APP_CONTEXT_DEPS_FILES",
    "FX_DEPS_FILE",
    "RUNTIME_IDENTIFIER",
})
{
    Console.WriteLine($"{key} = {AppContext.GetData(key) ?? "leer"}");
}

// Was die Runtime tatsächlich verwendet
Console.WriteLine($"IsServerGC: {GCSettings.IsServerGC}");
Console.WriteLine($"Kultur: {CultureInfo.CurrentCulture.Name} (leer heißt invariant)");`;

export const switchCode = `// In einer Bibliothek: ein eigener Schalter mit sicherem Standardwert
static class ParserOptions
{
    internal static bool UseNewParser { get; } =
        AppContext.TryGetSwitch("MyApp.UseNewParser", out bool on) && on;
}`;
