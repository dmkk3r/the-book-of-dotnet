// Code sample for the VerifyCard in suspension.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// Event names after Microsoft Learn "Garbage collection runtime events" (GCSuspendEEBegin_V1,
// GCSuspendEEEnd_V1, GCRestartEEBegin_V1, GCRestartEEEnd_V1, GCKeyword 0x1, Informational).
// TODO(verify): That an in-process EventListener receives these events from the
// "Microsoft-Windows-DotNETRuntime" source on .NET 8 with these exact EventName values (with or
// without the _V1 suffix, hence StartsWith), and that EventWrittenEventArgs.TimeStamp is the time
// the event was written, not the time it was dispatched to the listener.

export const suspendCode = `using System.Diagnostics.Tracing;

using var listener = new SuspendListener();

// Ein Thread rechnet ohne Pause in einer Schleife ohne Aufruf
var worker = new Thread(() => { long n = 0; while (true) n++; }) { IsBackground = true };
worker.Start();
// Ein Thread schläft: präemptiv, muss nicht angehalten werden
new Thread(() => Thread.Sleep(Timeout.Infinite)) { IsBackground = true }.Start();

for (int i = 0; i < 5; i++)
{
    GC.Collect();
    Thread.Sleep(200);
}

sealed class SuspendListener : EventListener
{
    private DateTime _suspendStart;

    protected override void OnEventSourceCreated(EventSource source)
    {
        if (source.Name == "Microsoft-Windows-DotNETRuntime")
            EnableEvents(source, EventLevel.Informational, (EventKeywords)0x1); // GCKeyword
    }

    protected override void OnEventWritten(EventWrittenEventArgs e)
    {
        string name = e.EventName ?? "";
        if (name.StartsWith("GCSuspendEEBegin"))
            _suspendStart = e.TimeStamp;
        else if (name.StartsWith("GCSuspendEEEnd"))
            Console.WriteLine(
                $"Anhalten dauerte {(e.TimeStamp - _suspendStart).TotalMicroseconds:F0} µs");
    }
}`;
