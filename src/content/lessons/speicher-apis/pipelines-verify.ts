// Code samples for the VerifyCard in pipelines.mdx. They live here because Prettier strips the
// indentation of template literals inside MDX props.
// TODO(verify): Whether SharpLab (Run mode) can reference System.IO.Pipelines; otherwise run as a
// console app with the NuGet package System.IO.Pipelines.

export const sharplabCode = `using System;
using System.Buffers;
using System.IO.Pipelines;
using System.Text;
using System.Threading.Tasks;

var pipe = new Pipe();
Task reading = ReadLinesAsync(pipe.Reader);

foreach (string part in new[] { "PING\\nECH", "O hi\\nTIM", "E 1\\n" })
{
    Write(pipe.Writer, part);            // GetSpan, Advance
    await pipe.Writer.FlushAsync();      // für den Reader sichtbar machen
    await Task.Delay(100);               // Reader Zeit zum Lesen geben
}
await pipe.Writer.CompleteAsync();
await reading;

static void Write(PipeWriter writer, string text)
{
    Span<byte> span = writer.GetSpan(text.Length);
    int n = Encoding.ASCII.GetBytes(text, span);
    writer.Advance(n);
}

static async Task ReadLinesAsync(PipeReader reader)
{
    while (true)
    {
        ReadResult result = await reader.ReadAsync();
        ReadOnlySequence<byte> buffer = result.Buffer;
        Console.WriteLine($"ReadAsync: {buffer.Length} Byte ungelesen");
        while (TryReadLine(ref buffer, out ReadOnlySequence<byte> line))
            Console.WriteLine($"  Zeile: {Encoding.ASCII.GetString(line)}");
        reader.AdvanceTo(buffer.Start, buffer.End);
        if (result.IsCompleted) break;
    }
    await reader.CompleteAsync();
}

static bool TryReadLine(ref ReadOnlySequence<byte> buffer, out ReadOnlySequence<byte> line)
{
    SequencePosition? pos = buffer.PositionOf((byte)'\\n');
    if (pos is null) { line = default; return false; }
    line = buffer.Slice(0, pos.Value);
    buffer = buffer.Slice(buffer.GetPosition(1, pos.Value));
    return true;
}`;

export const benchmarkCode = `[MemoryDiagnoser]
public class LineBench
{
    private byte[] _data = null!;

    [GlobalSetup]
    public void Setup()
    {
        var sb = new StringBuilder();
        for (int i = 0; i < 10_000; i++) sb.Append("GET /item/").Append(i).Append('\\n');
        _data = Encoding.ASCII.GetBytes(sb.ToString());
    }

    [Benchmark(Baseline = true)]
    public async Task<int> StreamReaderLines()
    {
        using var reader = new StreamReader(new MemoryStream(_data));
        int count = 0;
        while (await reader.ReadLineAsync() is not null) count++;
        return count;
    }

    [Benchmark]
    public async Task<int> PipeReaderLines()
    {
        PipeReader reader = PipeReader.Create(new MemoryStream(_data));
        int count = 0;
        while (true)
        {
            ReadResult result = await reader.ReadAsync();
            ReadOnlySequence<byte> buffer = result.Buffer;
            while (buffer.PositionOf((byte)'\\n') is SequencePosition pos)
            {
                count++;
                buffer = buffer.Slice(buffer.GetPosition(1, pos));
            }
            reader.AdvanceTo(buffer.Start, buffer.End);
            if (result.IsCompleted) break;
        }
        await reader.CompleteAsync();
        return count;
    }
}`;
