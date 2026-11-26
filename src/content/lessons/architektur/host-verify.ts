// Code sample for the VerifyCard in host.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Property names as passed by hostpolicy in .NET 8 and 9.

export const propsCode = `using System.Runtime.InteropServices;

Console.WriteLine(RuntimeInformation.FrameworkDescription);
Console.WriteLine(AppContext.BaseDirectory);
Console.WriteLine(Environment.ProcessPath);

// Was der Host der Runtime beim Start übergeben hat
string[] keys =
{
    "NATIVE_DLL_SEARCH_DIRECTORIES",
    "TRUSTED_PLATFORM_ASSEMBLIES",
};
foreach (var key in keys)
{
    var value = AppContext.GetData(key) as string ?? "leer";
    var parts = value.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries);
    Console.WriteLine($"{key}: {parts.Length} Einträge");
    foreach (var p in parts.Take(3))
        Console.WriteLine($"  {p}");
}`;
