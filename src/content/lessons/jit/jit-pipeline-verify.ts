// Code samples for the VerifyCard and the experiments in jit-pipeline.mdx. They live here because
// Prettier strips the indentation of template literals inside MDX props.

export const sharplabCode = `using System.Runtime.CompilerServices;

public static class C
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int SumSquares(int a, int b)
        => Square(a) + Square(b);

    public static int Square(int x) => x * x;

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int SumSquaresNoInline(int a, int b)
        => SquareNoInline(a) + SquareNoInline(b);

    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int SquareNoInline(int x) => x * x;
}`;

export const consoleCode = `using System.Runtime.CompilerServices;

// Lange genug laufen, damit Tier 1 entsteht
long total = 0;
for (int round = 0; round < 50; round++)
{
    for (int i = 0; i < 100_000; i++)
        total += C.SumSquares(i, round);
    Thread.Sleep(10);
}
Console.WriteLine(total);

static class C
{
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static int SumSquares(int a, int b) => Square(a) + Square(b);

    public static int Square(int x) => x * x;
}`;
