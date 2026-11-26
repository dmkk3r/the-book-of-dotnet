// Code samples for the VerifyCard in trimming.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Exact warning codes and texts printed by dotnet publish on .NET 8 and 9
// (expected: IL2026 for JsonSerializer.Serialize<T>, IL2057 for Type.GetType(name)).
// TODO(verify): That the trimmed app throws for the reflection call while dotnet run works.

export const trimDemoCode = `// TrimDemo.csproj: <TargetFramework>net8.0</TargetFramework>
// Veröffentlichen:
//   dotnet publish -c Release -r linux-x64 -p:PublishTrimmed=true
// Starten (beide Varianten vergleichen):
//   dotnet run -c Release
//   ./bin/Release/net8.0/linux-x64/publish/TrimDemo
using System.Reflection;
using System.Text.Json;

var person = new Person("Ada", 36);

// 1. Reflection über einen String aus der Umgebung
string typeName = Environment.GetEnvironmentVariable("PLUGIN") ?? "Audit";
Type? type = Type.GetType(typeName);
Console.WriteLine($"Typ gefunden: {type is not null}");

// 2. Methode per Literal: diese Form versteht die Analyse
MethodInfo? m = typeof(Person).GetMethod("Describe");
Console.WriteLine(m?.Invoke(person, null));

// 3. Reflection-basierte Serialisierung
Console.WriteLine(JsonSerializer.Serialize(person));

record Person(string Name, int Age)
{
    public string Describe() => $"{Name} ({Age})";
}

class Audit { }`;
