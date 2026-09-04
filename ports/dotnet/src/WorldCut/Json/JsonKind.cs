namespace WorldCut.Json;

/// <summary>The six JSON value shapes WorldCut accepts.</summary>
public enum JsonKind
{
    /// <summary>The JSON <c>null</c> literal.</summary>
    Null = 0,

    /// <summary>A JSON <c>true</c> or <c>false</c> literal.</summary>
    Boolean = 1,

    /// <summary>A finite JSON number, held as an IEEE 754 binary64 value.</summary>
    Number = 2,

    /// <summary>A JSON string.</summary>
    String = 3,

    /// <summary>A JSON array.</summary>
    Array = 4,

    /// <summary>A JSON object.</summary>
    Object = 5,
}
