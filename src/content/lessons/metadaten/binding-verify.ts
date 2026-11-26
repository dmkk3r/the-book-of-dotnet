// Code samples for the VerifyCards in binding.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Expected output on .NET 8 and 9: System.Runtime reference "Version=8.0.0.0" (net8.0),
// CoreLib assembly version 8.0.0.0 on every 8.0.x patch, file version and informational version
// changing with the patch.

export const versionsCode = `using System.Reflection;

// Was App.dll verlangt (AssemblyRef-Tabelle)
foreach (var r in Assembly.GetExecutingAssembly().GetReferencedAssemblies())
    Console.WriteLine($"verlangt: {r.FullName}");

Console.WriteLine();

// Was tatsächlich geladen wurde, mit allen vier Versionen
foreach (var a in AppDomain.CurrentDomain.GetAssemblies().OrderBy(a => a.GetName().Name))
{
    var n = a.GetName();
    var file = a.GetCustomAttribute<AssemblyFileVersionAttribute>()?.Version ?? "keine";
    var info = a.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "keine";
    Console.WriteLine($"{n.Name}");
    Console.WriteLine($"  Assembly-Version: {n.Version}");
    Console.WriteLine($"  Dateiversion:     {file}");
    Console.WriteLine($"  Info-Version:     {info}");
    Console.WriteLine($"  Token:            {Convert.ToHexString(n.GetPublicKeyToken() ?? [])}");
}`;

export const lowerCode = `# Bibliothek in zwei Versionen bauen
dotnet new classlib -n Shop -o Shop
dotnet build Shop -c Release -p:AssemblyVersion=2.0.0.0 -o out/v2
dotnet build Shop -c Release -p:AssemblyVersion=1.0.0.0 -o out/v1

# App gegen Version 2 bauen (Projektverweis oder Verweis auf out/v2/Shop.dll)
dotnet new console -n App -o App
# ... in Program.cs einen Typ aus Shop verwenden, bauen ...

# Danach Shop.dll im Ausgabeordner der App durch out/v1/Shop.dll ersetzen
# und die App starten: Der Name stimmt, die Version ist zu niedrig.`;
