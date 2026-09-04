using WorldCut.Model;

namespace WorldCut.Tests;

/// <summary>
/// Timestamp grammar and ordering, including the ECMAScript year-zero domain
/// that <see cref="DateTime"/> cannot represent.
/// </summary>
public sealed class NormalizedTimestampTests
{
    [Theory]
    [InlineData("0000-01-01T00:00:00.000Z", -62167219200000L)]
    [InlineData("1970-01-01T00:00:00.000Z", 0L)]
    [InlineData("1969-12-31T23:59:59.999Z", -1L)]
    [InlineData("2026-09-02T18:00:00.000Z", 1788372000000L)]
    [InlineData("2000-02-29T12:00:00.500Z", 951825600500L)]
    [InlineData("9999-12-31T23:59:59.999Z", 253402300799999L)]
    public void Accepted_timestamps_produce_the_ecmascript_epoch_ordinal(string text, long expected)
    {
        Assert.True(NormalizedTimestamp.TryParse(text, out NormalizedTimestamp timestamp));

        Assert.Equal(expected, timestamp.EpochMilliseconds);
        Assert.Equal(text, timestamp.Text);
    }

    [Theory]
    [InlineData("2026-09-02")]
    [InlineData("2026-09-02T18:00:00Z")]
    [InlineData("2026-09-02T18:00:00.000")]
    [InlineData("2026-09-02T18:00:00.000+00:00")]
    [InlineData("2026-09-02t18:00:00.000Z")]
    [InlineData("2026-09-02T18:00:00.000z")]
    [InlineData("2026-13-01T00:00:00.000Z")]
    [InlineData("2026-00-01T00:00:00.000Z")]
    [InlineData("2026-02-30T00:00:00.000Z")]
    [InlineData("2026-09-00T00:00:00.000Z")]
    [InlineData("2026-09-02T24:00:00.000Z")]
    [InlineData("2026-09-02T18:60:00.000Z")]
    [InlineData("2026-09-02T18:00:60.000Z")]
    [InlineData("2026-09-02T18:00:00.0000Z")]
    [InlineData("+2026-09-02T18:00:00.000Z")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejected_timestamps_are_not_parsed(string? text) =>
        Assert.False(NormalizedTimestamp.TryParse(text, out _));

    [Theory]
    [InlineData("1900-02-28T00:00:00.000Z", true)]
    [InlineData("1900-02-29T00:00:00.000Z", false)]
    [InlineData("2000-02-29T00:00:00.000Z", true)]
    [InlineData("2024-02-29T00:00:00.000Z", true)]
    [InlineData("2026-02-29T00:00:00.000Z", false)]
    [InlineData("0000-02-29T00:00:00.000Z", true)]
    public void Leap_days_follow_the_proleptic_gregorian_calendar(string text, bool accepted) =>
        Assert.Equal(accepted, NormalizedTimestamp.TryParse(text, out _));

    [Fact]
    public void Ordering_matches_chronological_order()
    {
        Assert.True(NormalizedTimestamp.TryParse("0000-01-01T00:00:00.000Z", out NormalizedTimestamp yearZero));
        Assert.True(NormalizedTimestamp.TryParse("2026-09-02T18:00:00.000Z", out NormalizedTimestamp later));
        Assert.True(NormalizedTimestamp.TryParse("0000-01-01T00:00:00.000Z", out NormalizedTimestamp sameAsYearZero));

        Assert.True(yearZero < later);
        Assert.True(later > yearZero);
        Assert.True(yearZero <= sameAsYearZero);
        Assert.True(later >= yearZero);
        Assert.True(sameAsYearZero >= yearZero);
        Assert.True(yearZero == sameAsYearZero);
        Assert.False(yearZero != sameAsYearZero);
        Assert.NotEqual(yearZero, later);
        Assert.Equal(later, NormalizedTimestamp.Max(yearZero, later));
        Assert.Equal(yearZero, NormalizedTimestamp.Min(yearZero, later));
        Assert.True(yearZero.CompareTo(later) < 0);
        Assert.Equal(yearZero.GetHashCode(), sameAsYearZero.GetHashCode());
        Assert.True(yearZero.Equals((object)sameAsYearZero));
        Assert.Equal("0000-01-01T00:00:00.000Z", yearZero.ToString());
    }

    [Fact]
    public void Year_zero_timestamps_verify_end_to_end()
    {
        string json = Fixtures.CoherentInput().Replace("2026-", "0000-", StringComparison.Ordinal);

        VerificationResult result = WorldCutVerifier.VerifyJson(json);

        Assert.Equal(ContractVerdict.ContractSatisfied, result.Verdict);
        Assert.Contains(
            result.RequirementResults,
            item => item.Details.TryGetProperty("commonWindow", out _));
    }

    [Fact]
    public void Year_zero_timestamps_still_enforce_interval_and_timing_rules()
    {
        string json = Fixtures.CoherentInput()
            .Replace("2026-", "0000-", StringComparison.Ordinal)
            .Replace("\"decisionTime\":\"0000-09-02T18:00:00.000Z\"", "\"decisionTime\":\"0000-09-02T17:00:00.000Z\"", StringComparison.Ordinal);

        Assert.Equal(
            WorldCutErrorCode.InvalidInput,
            Assert.Throws<WorldCutException>(() => WorldCutVerifier.VerifyJson(json)).Code);
    }
}
