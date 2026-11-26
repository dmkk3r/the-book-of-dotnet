// Code sample for the VerifyCard in assembly-load-context.mdx. It lives here because Prettier
// strips the indentation of template literals inside MDX props.
// The trick: the program loads its own assembly a second time into a collectible context, so one
// file is enough to show type identity and unloading.
// TODO(verify): Run as a console app (net8.0, dotnet run -c Release) and record the output.
// Expected: "Name gleich: True", "Typ gleich: False", "Kontexte: Kopie / Default", an
// InvalidCastException message naming Message twice, then IsAlive turns False after one or two
// collections. Check whether the exception object kept in e (and its stack trace) delays unloading.

export const alcCode = `using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.Loader;

public class Message { public string Text = "Hallo"; }

public static class Program
{
    public static void Main()
    {
        WeakReference weak = Run();
        for (int i = 1; weak.IsAlive && i <= 10; i++)
        {
            GC.Collect();
            GC.WaitForPendingFinalizers();
            Console.WriteLine($"Nach GC {i}: Kontext lebt noch? {weak.IsAlive}");
        }
    }

    // NoInlining: Keine lokale Variable dieser Methode darf in Main weiterleben
    [MethodImpl(MethodImplOptions.NoInlining)]
    static WeakReference Run()
    {
        var ctx = new AssemblyLoadContext("Kopie", isCollectible: true);
        Assembly copy = ctx.LoadFromAssemblyPath(typeof(Program).Assembly.Location);

        Type mine = typeof(Message);
        Type theirs = copy.GetType("Message")!;
        Console.WriteLine($"Name gleich: {mine.FullName == theirs.FullName}");
        Console.WriteLine($"Typ gleich:  {mine == theirs}");
        Console.WriteLine($"Kontexte:    {AssemblyLoadContext.GetLoadContext(theirs.Assembly)!.Name}"
                        + $" / {AssemblyLoadContext.GetLoadContext(mine.Assembly)!.Name}");

        object o = Activator.CreateInstance(theirs)!;
        try
        {
            var m = (Message)o;
        }
        catch (InvalidCastException e)
        {
            Console.WriteLine(e.Message);
        }

        ctx.Unload();
        Console.WriteLine("Unload() ist zurückgekehrt");
        return new WeakReference(ctx);
    }
}`;
