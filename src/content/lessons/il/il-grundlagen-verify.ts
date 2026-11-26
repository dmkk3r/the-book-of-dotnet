// Code samples for the VerifyCard in il-grundlagen.mdx. They live here because Prettier strips
// the indentation of template literals inside MDX props.

export const sharplabCode = `public class C
{
    static int Scale(int amount, int factor)
    {
        int result = amount * factor;
        if (result > 100)
            result = 100;
        return result;
    }

    static object Run()
    {
        var c = new Counter();
        c.Add(5);
        return c.Value;
    }
}

class Counter
{
    public int Value;
    public void Add(int n) => Value += n;
}`;

export const reflectionCode = `using System.Reflection;

class Program
{
    static int Scale(int amount, int factor)
    {
        int result = amount * factor;
        if (result > 100)
            result = 100;
        return result;
    }

    static void Main()
    {
        MethodBody body = typeof(Program)
            .GetMethod(nameof(Scale), BindingFlags.NonPublic | BindingFlags.Static)!
            .GetMethodBody()!;
        byte[] il = body.GetILAsByteArray()!;

        Console.WriteLine($"maxstack: {body.MaxStackSize}");
        Console.WriteLine($"Locals:   {string.Join(", ", body.LocalVariables.Select(l => l.LocalType.Name))}");
        Console.WriteLine($"IL:       {il.Length} Byte, {Convert.ToHexString(il)}");
    }
}`;
