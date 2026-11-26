// Code samples for the VerifyCard in safe-points.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Expected output "ohne KeepAlive: False" and "mit KeepAlive: True" in Release
// without debugger, "True" for both in Debug; that AggressiveOptimization makes the JIT compile
// both methods fully optimized right away (no Tier 0 with untracked locals).

export const lifetimeCode = `using System.Runtime.CompilerServices;

Console.WriteLine($"ohne KeepAlive: {WithoutKeepAlive()}");
Console.WriteLine($"mit KeepAlive:  {WithKeepAlive()}");

// AggressiveOptimization: sofort optimiert übersetzen, ohne Tier 0
[MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
static bool WithoutKeepAlive()
{
    var obj = new object();
    var weak = new WeakReference(obj);
    GC.Collect();                 // obj wird danach nicht mehr verwendet
    return weak.IsAlive;
}

[MethodImpl(MethodImplOptions.NoInlining | MethodImplOptions.AggressiveOptimization)]
static bool WithKeepAlive()
{
    var obj = new object();
    var weak = new WeakReference(obj);
    GC.Collect();
    bool alive = weak.IsAlive;
    GC.KeepAlive(obj);            // letzte Verwendung: obj lebt bis hier
    return alive;
}`;

export const disasmCode = `// Kopf der Listings ansehen:
//   DOTNET_JitDisasm="Sum Poll" dotnet run -c Release
// Erwartet im Kopf von Sum:  ; fully interruptible
// Erwartet im Kopf von Poll: ; partially interruptible

using System.Runtime.CompilerServices;

var data = new int[1000];
var queue = new Queue<int>(data);
for (int i = 0; i < 200; i++) Sum(data);   // genug Aufrufe für Tier 1
Poll(queue);

[MethodImpl(MethodImplOptions.NoInlining)]
static int Sum(int[] a)
{
    int s = 0;
    foreach (int x in a) s += x;
    return s;
}

[MethodImpl(MethodImplOptions.NoInlining)]
static void Poll(Queue<int> q)
{
    while (q.Count > 0) Handle(q.Dequeue());
}

[MethodImpl(MethodImplOptions.NoInlining)]
static void Handle(int x) { }`;
