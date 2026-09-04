namespace WorldCut.Model;

/// <summary>
/// The four-component resource identity compared by WorldCut.
/// </summary>
/// <remarks>
/// Versions are comparable only when all four components are equal.
/// </remarks>
public sealed class ResourceIdentity : IEquatable<ResourceIdentity>
{
    internal ResourceIdentity(string provider, string account, string kind, string key)
    {
        Provider = provider;
        Account = account;
        Kind = kind;
        Key = key;
    }

    /// <summary>The system that produced the resource.</summary>
    public string Provider { get; }

    /// <summary>The tenant or account that owns the resource.</summary>
    public string Account { get; }

    /// <summary>The resource type.</summary>
    public string Kind { get; }

    /// <summary>The provider-scoped resource key.</summary>
    public string Key { get; }

    /// <summary>Compares two identities component by component.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when every component is equal.</returns>
    public static bool operator ==(ResourceIdentity? left, ResourceIdentity? right) =>
        left is null ? right is null : left.Equals(right);

    /// <summary>Compares two identities component by component.</summary>
    /// <param name="left">The left operand.</param>
    /// <param name="right">The right operand.</param>
    /// <returns><see langword="true"/> when any component differs.</returns>
    public static bool operator !=(ResourceIdentity? left, ResourceIdentity? right) =>
        !(left == right);

    /// <inheritdoc />
    public bool Equals(ResourceIdentity? other) =>
        other is not null
        && string.Equals(Provider, other.Provider, StringComparison.Ordinal)
        && string.Equals(Account, other.Account, StringComparison.Ordinal)
        && string.Equals(Kind, other.Kind, StringComparison.Ordinal)
        && string.Equals(Key, other.Key, StringComparison.Ordinal);

    /// <inheritdoc />
    public override bool Equals(object? obj) => Equals(obj as ResourceIdentity);

    /// <inheritdoc />
    public override int GetHashCode() =>
        HashCode.Combine(
            StringComparer.Ordinal.GetHashCode(Provider),
            StringComparer.Ordinal.GetHashCode(Account),
            StringComparer.Ordinal.GetHashCode(Kind),
            StringComparer.Ordinal.GetHashCode(Key));
}
