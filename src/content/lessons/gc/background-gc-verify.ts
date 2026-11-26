// Code sample for the VerifyCard in background-gc.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Sizes (2 million nodes, 1 ms probe interval) chosen so that gen2 is large enough
// for visible pauses on a typical machine; not measured.

export const verifyCode = `using System.Diagnostics;

// Großer, langlebiger Graph: wird nach Gen2 promotet und muss bei jeder vollen GC markiert werden
var nodes = new List<Node>();
for (int i = 0; i < 2_000_000; i++) nodes.Add(new Node { Next = nodes.Count > 0 ? nodes[^1] : null });

// Mess-Thread: schläft 1 ms und misst, wie lange es wirklich gedauert hat
double maxStallMs = 0;
var probe = new Thread(() =>
{
    var sw = new Stopwatch();
    while (true)
    {
        sw.Restart();
        Thread.Sleep(1);
        maxStallMs = Math.Max(maxStallMs, sw.Elapsed.TotalMilliseconds);
    }
}) { IsBackground = true };
probe.Start();

// Müll erzeugen und gelegentlich Gen2-Daten ersetzen, damit volle Collections nötig werden
var rnd = new Random(42);
var sink = new object[1];
for (int i = 0; i < 200_000_000; i++)
{
    sink[0] = new byte[64];
    if (i % 1000 == 0) nodes[rnd.Next(nodes.Count)] = new Node();
}

Console.WriteLine($"Gen2-Collections: {GC.CollectionCount(2)}");
Console.WriteLine($"Längste Unterbrechung des Mess-Threads: {maxStallMs:F1} ms");
GC.KeepAlive(nodes);

class Node { public Node? Next; public long Payload; }`;
