// Code samples for the VerifyCard in readytorun.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): System.Runtime.JitInfo.GetCompiledMethodCount and GetCompilationTime exist since
// .NET 6 and count methods compiled by the JIT (including Tier 1 rejits) in the whole process.

export const jitCountCode = `using System.Runtime;

var prices = new List<Price>();
for (int i = 0; i < 1000; i++) prices.Add(new Price(i));
Console.WriteLine(Billing.Sum(prices));

Console.WriteLine($"JIT-Methoden: {JitInfo.GetCompiledMethodCount()}");
Console.WriteLine($"JIT-Zeit:     {JitInfo.GetCompilationTime().TotalMilliseconds:F1} ms");

record struct Price(decimal Amount);

static class Billing
{
    public static decimal Sum(List<Price> items)
    {
        decimal total = 0;
        foreach (var p in items) total += p.Amount;
        return total;
    }
}

// 1. dotnet run -c Release
// 2. dotnet publish -c Release -r linux-x64 -p:PublishReadyToRun=true
//    und die veröffentlichte App starten
// 3. dieselbe App mit DOTNET_ReadyToRun=0 starten
// RID anpassen: win-x64, osx-arm64, linux-arm64 ...`;

export const jitListCode = `# Welche Methoden der JIT übersetzt, mit Stufe:
DOTNET_JitStdOutFile=jit.txt DOTNET_JitDisasmSummary=1 ./App

# In jit.txt nach Billing und Price suchen:
grep -E "Billing|Price" jit.txt`;
