using System.Security.Cryptography;

namespace WorldCut.Tests;

/// <summary>
/// Independent SHA-256 helper used by the tests so that manifest and raw-vector
/// checks never reuse the implementation under test.
/// </summary>
internal static class Digest
{
    internal static string Sha256Hex(byte[] source)
    {
#pragma warning disable CA1308 // Conformance digests are specified as lowercase hexadecimal.
        return Convert.ToHexString(SHA256.HashData(source)).ToLowerInvariant();
#pragma warning restore CA1308
    }
}
