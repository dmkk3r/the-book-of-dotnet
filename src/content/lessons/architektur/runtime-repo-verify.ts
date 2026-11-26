// Code sample for the VerifyCard in runtime-repo.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): That the informational version of System.Private.CoreLib has the form
// "<version>+<commit hash of dotnet/runtime>" (e.g. "9.0.0+9d5a6a9aa463d6d10b0b0ba6d5982cc82f363dc3").

export const commitCode = `using System.Reflection;
using System.Runtime.InteropServices;

Console.WriteLine(RuntimeInformation.FrameworkDescription);
Console.WriteLine(Environment.Version);

// Aus welchem Commit von dotnet/runtime stammt diese CoreLib?
var corelib = typeof(object).Assembly;
var info = corelib
    .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
    .InformationalVersion ?? "keine Angabe";
Console.WriteLine(info);

int plus = info.IndexOf('+');
if (plus >= 0)
{
    string commit = info[(plus + 1)..];
    Console.WriteLine($"https://github.com/dotnet/runtime/tree/{commit}");
}`;
