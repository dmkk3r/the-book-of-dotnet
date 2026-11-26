// Code samples for the VerifyCards in gc-handles.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const handlesCode = `using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;

class Data { public byte[] Payload = new byte[1000]; }

static class Program
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    static (WeakReference<Data> weak, GCHandle strong) Create() =>
        (new WeakReference<Data>(new Data()), GCHandle.Alloc(new Data()));

    static void Main()
    {
        var (weak, strong) = Create();
        GC.Collect(0);
        Console.WriteLine($"weak lebt: {weak.TryGetTarget(out _)}");
        Console.WriteLine($"strong lebt: {strong.Target is not null}");
        strong.Free();
    }
}`;

export const cwtCode = `using System.Runtime.CompilerServices;

class Widget { }
class Meta { public Widget Owner; public Meta(Widget w) => Owner = w; }

static class Program
{
    static readonly Dictionary<object, Meta> s_dict = new();
    static readonly ConditionalWeakTable<object, Meta> s_cwt = new();

    [MethodImpl(MethodImplOptions.NoInlining)]
    static (WeakReference d, WeakReference c) Fill()
    {
        var k1 = new Widget(); s_dict[k1] = new Meta(k1);
        var k2 = new Widget(); s_cwt.Add(k2, new Meta(k2));
        return (new WeakReference(k1), new WeakReference(k2));
    }

    static void Main()
    {
        var (d, c) = Fill();
        GC.Collect();
        Console.WriteLine($"Schlüssel im Dictionary lebt: {d.IsAlive}");
        Console.WriteLine($"Schlüssel in der Tabelle lebt: {c.IsAlive}");
    }
}`;
