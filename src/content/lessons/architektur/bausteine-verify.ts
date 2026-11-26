// Code sample for the VerifyCard in bausteine.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.

export const whereCode = `using System.Runtime.InteropServices;

Console.WriteLine(RuntimeInformation.FrameworkDescription);
Console.WriteLine(Environment.Version);

// Wo liegen die Bausteine wirklich?
Console.WriteLine(typeof(object).Assembly.Location);
Console.WriteLine(typeof(Console).Assembly.Location);
Console.WriteLine(typeof(Program).Assembly.Location);

// Gegen welche Assembly wurde kompiliert?
foreach (var r in typeof(Program).Assembly.GetReferencedAssemblies())
    Console.WriteLine($"Verweis: {r.Name} {r.Version}");

partial class Program { }`;
