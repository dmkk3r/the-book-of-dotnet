// Code sample for the VerifyCard in metadaten-tabellen.mdx. It lives here because Prettier
// strips the indentation of template literals inside MDX props.
// TODO(verify): Run in a Release build with the current SDK and record the output (row counts,
// MemberRef tokens, Main token 0x06000001, ldstr token 0x70000001).

export const tokenCode = `using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.Metadata.Ecma335;
using System.Reflection.PortableExecutable;

class Program
{
    static void Main()
    {
        Console.WriteLine("Hallo");
        Helper();
        Inspect();
    }

    static void Helper() { }

    static void Inspect()
    {
        // 1. Tabellen und Tokens direkt aus der Datei
        using var pe = new PEReader(File.OpenRead(typeof(Program).Assembly.Location));
        MetadataReader md = pe.GetMetadataReader();

        foreach (var t in new[] { TableIndex.TypeDef, TableIndex.TypeRef, TableIndex.MethodDef,
                                  TableIndex.MemberRef, TableIndex.AssemblyRef })
            Console.WriteLine($"{t,-12} {md.GetTableRowCount(t),3} Zeilen");

        foreach (MemberReferenceHandle h in md.MemberReferences)
        {
            MemberReference mr = md.GetMemberReference(h);
            string parent = mr.Parent.Kind == HandleKind.TypeReference
                ? md.GetString(md.GetTypeReference((TypeReferenceHandle)mr.Parent).Name)
                : mr.Parent.Kind.ToString();
            Console.WriteLine($"0x{MetadataTokens.GetToken(h):X8}  {parent}::{md.GetString(mr.Name)}");
        }

        // 2. Dieselben Tokens über Reflection
        MethodInfo main = typeof(Program).GetMethod("Main", BindingFlags.NonPublic | BindingFlags.Static)!;
        Console.WriteLine($"Main: 0x{main.MetadataToken:X8}");

        byte[] il = main.GetMethodBody()!.GetILAsByteArray()!;
        Module module = main.Module;
        for (int i = 0; i < il.Length;)
        {
            byte op = il[i];
            if (op is 0x72 or 0x28) // ldstr oder call, beide mit 4-Byte-Token
            {
                int token = BitConverter.ToInt32(il, i + 1);
                string target = op == 0x72
                    ? $"\\"{module.ResolveString(token)}\\""
                    : module.ResolveMethod(token)!.ToString()!;
                Console.WriteLine($"IL_{i:X4}  0x{token:X8}  {target}");
                i += 5;
            }
            else i += 1; // Main enthält sonst nur nop (Debug) und ret
        }
    }
}`;
