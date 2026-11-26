// Code sample for the VerifyCard in exception-handling.mdx. It lives here because Prettier strips
// the indentation of template literals inside MDX props.
// TODO(verify): Expected output on .NET 8, 9 and 10 in SharpLab "Run" mode and locally:
// order "Filter in Main", "Finally in B", "Catch in Main"; that the trace after `throw ex;`
// starts in RethrowEx and no longer contains Fail; that the trace after `throw;` contains Fail;
// that the ExceptionDispatchInfo trace contains Fail followed by the
// "--- End of stack trace from previous location ---" separator.

export const orderCode = `using System.Runtime.CompilerServices;
using System.Runtime.ExceptionServices;

// 1. Reihenfolge: Filter vor finally
try { B(); }
catch (InvalidOperationException) when (Log("Filter in Main"))
{
    Console.WriteLine("Catch in Main");
}

// 2. throw; gegen throw ex;
try { RethrowEx(); }
catch (Exception e) { Console.WriteLine("throw ex:\\n" + e.StackTrace); }

try { Rethrow(); }
catch (Exception e) { Console.WriteLine("throw:\\n" + e.StackTrace); }

// 3. Exception aufheben und später werfen
ExceptionDispatchInfo? saved = null;
try { Fail(); }
catch (Exception e) { saved = ExceptionDispatchInfo.Capture(e); }
try { saved!.Throw(); }
catch (Exception e) { Console.WriteLine("EDI:\\n" + e.StackTrace); }

static void B()
{
    try { throw new InvalidOperationException("kaputt"); }
    finally { Console.WriteLine("Finally in B"); }
}

static bool Log(string text) { Console.WriteLine(text); return true; }

[MethodImpl(MethodImplOptions.NoInlining)]
static void Fail() => throw new InvalidOperationException("kaputt");

[MethodImpl(MethodImplOptions.NoInlining)]
static void RethrowEx()
{
    try { Fail(); }
    catch (Exception ex) { throw ex; }   // setzt den Stack-Trace zurück
}

[MethodImpl(MethodImplOptions.NoInlining)]
static void Rethrow()
{
    try { Fail(); }
    catch (Exception) { throw; }         // behält den Stack-Trace
}`;
