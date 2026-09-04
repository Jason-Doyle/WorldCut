using WorldCut.Json;

namespace WorldCut.Model;

/// <summary>The requirement kinds defined by protocol 0.1.</summary>
public enum RequirementType
{
    /// <summary>An exact dependency between two roles.</summary>
    Dependency = 0,

    /// <summary>A shared non-empty validity interval across roles.</summary>
    CommonValidTime = 1,

    /// <summary>An exact JSON value at a deterministic path.</summary>
    ValueEquals = 2,
}

/// <summary>The fields shared by every contract requirement.</summary>
public abstract class ContractRequirement
{
    private protected ContractRequirement(
        string id,
        string description,
        bool required,
        JsonValue raw)
    {
        Id = id;
        Description = description;
        Required = required;
        Raw = raw;
    }

    /// <summary>The requirement identifier, unique within one contract.</summary>
    public string Id { get; }

    /// <summary>The human-readable requirement description used in summaries.</summary>
    public string Description { get; }

    /// <summary>Whether the requirement affects the aggregate verdict.</summary>
    public bool Required { get; }

    /// <summary>The requirement kind.</summary>
    public abstract RequirementType Type { get; }

    /// <summary>The wire spelling of <see cref="Type"/>.</summary>
    public abstract string TypeName { get; }

    /// <summary>
    /// The complete accepted requirement JSON, used verbatim in the digest
    /// preimage.
    /// </summary>
    public JsonValue Raw { get; }
}

/// <summary>Requires one role to depend on the exact version of another.</summary>
public sealed class DependencyRequirement : ContractRequirement
{
    internal DependencyRequirement(
        string id,
        string description,
        bool required,
        JsonValue raw,
        string dependentRole,
        string targetRole,
        string dependencyName)
        : base(id, description, required, raw)
    {
        DependentRole = dependentRole;
        TargetRole = targetRole;
        DependencyName = dependencyName;
    }

    /// <inheritdoc />
    public override RequirementType Type => RequirementType.Dependency;

    /// <inheritdoc />
    public override string TypeName => "dependency";

    /// <summary>The role that declares the dependency.</summary>
    public string DependentRole { get; }

    /// <summary>The role that owns the depended-upon resource.</summary>
    public string TargetRole { get; }

    /// <summary>The dependency name to compare.</summary>
    public string DependencyName { get; }
}

/// <summary>Requires several roles to share a non-empty validity interval.</summary>
public sealed class CommonValidTimeRequirement : ContractRequirement
{
    internal CommonValidTimeRequirement(
        string id,
        string description,
        bool required,
        JsonValue raw,
        string[] roles,
        ValidityInterval within)
        : base(id, description, required, raw)
    {
        Roles = Array.AsReadOnly(roles);
        Within = within;
    }

    /// <inheritdoc />
    public override RequirementType Type => RequirementType.CommonValidTime;

    /// <inheritdoc />
    public override string TypeName => "common_valid_time";

    /// <summary>The distinct roles that must share a valid time, in declaration order.</summary>
    public IReadOnlyList<string> Roles { get; }

    /// <summary>The contract window the shared interval must fall inside.</summary>
    public ValidityInterval Within { get; }
}

/// <summary>Requires a deterministic JSON path to equal an exact value.</summary>
public sealed class ValueEqualsRequirement : ContractRequirement
{
    internal ValueEqualsRequirement(
        string id,
        string description,
        bool required,
        JsonValue raw,
        string role,
        string[] path,
        JsonValue expected)
        : base(id, description, required, raw)
    {
        Role = role;
        Path = Array.AsReadOnly(path);
        Expected = expected;
    }

    /// <inheritdoc />
    public override RequirementType Type => RequirementType.ValueEquals;

    /// <inheritdoc />
    public override string TypeName => "value_equals";

    /// <summary>The role whose observed value is inspected.</summary>
    public string Role { get; }

    /// <summary>The path segments to follow through the observed value.</summary>
    public IReadOnlyList<string> Path { get; }

    /// <summary>The required value at <see cref="Path"/>.</summary>
    public JsonValue Expected { get; }
}
