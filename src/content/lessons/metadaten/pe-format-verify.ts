// Code sample for the VerifyCard in pe-format.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Run the sample against a Release build with the current SDK and record the output
// (Machine, PE32 or PE32+, section names, metadata version, method sizes).

export const peReaderCode = `using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;

string path = args.Length > 0 ? args[0] : typeof(Program).Assembly.Location;
using var stream = File.OpenRead(path);
using var pe = new PEReader(stream);

PEHeaders h = pe.PEHeaders;
Console.WriteLine($"Machine:    {h.CoffHeader.Machine}");
Console.WriteLine($"Format:     {h.PEHeader!.Magic}");
Console.WriteLine($"CLI-Header: RVA 0x{h.PEHeader.CorHeaderTableDirectory.RelativeVirtualAddress:X}");
Console.WriteLine($"Flags:      {h.CorHeader!.Flags}");
Console.WriteLine($"Metadaten:  RVA 0x{h.CorHeader.MetadataDirectory.RelativeVirtualAddress:X}");

foreach (SectionHeader s in h.SectionHeaders)
    Console.WriteLine($"{s.Name,-8} RVA 0x{s.VirtualAddress:X5}  Datei 0x{s.PointerToRawData:X5}");

MetadataReader md = pe.GetMetadataReader();
Console.WriteLine($"Metadaten-Version: {md.MetadataVersion}");

foreach (MethodDefinitionHandle handle in md.MethodDefinitions)
{
    MethodDefinition m = md.GetMethodDefinition(handle);
    if (m.RelativeVirtualAddress == 0) continue; // abstrakt, extern oder Interface
    MethodBodyBlock body = pe.GetMethodBody(m.RelativeVirtualAddress);
    Console.WriteLine(
        $"{md.GetString(m.Name),-12} RVA 0x{m.RelativeVirtualAddress:X}  " +
        $"Rumpf {body.Size} Byte  IL {body.GetILBytes()!.Length} Byte  MaxStack {body.MaxStack}");
}`;
