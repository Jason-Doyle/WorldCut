#!/usr/bin/env pwsh

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$portRoot = Split-Path -Parent $PSScriptRoot
$sourceRoot = Join-Path $portRoot 'src/WorldCut/Vendored/JcsNet'
$headerBoundary = "// -----------------------------------------------------------------------------`n"
$utf8 = [System.Text.UTF8Encoding]::new($false)

$expectedHashes = [ordered]@{
    'CanonicalJsonSerializer.cs' = '3e9083f0273c29cebbc2e6e12eee9ce083580862a310e5b198ff9f8f0c624375'
    'EcmaScriptNumberFormatter.cs' = '6f4f63a52d7e5f39a27efbbd14d8f095d7480ddbe4c455653778b0aedb1eb2fb'
    'JcsException.cs' = '78156a3dc02aa98065446f4eb81fb34f2c24ad9687d99ff7dc0a395746a3ea4c'
    'JsonCanonicalizer.cs' = 'dd8c55948053399755cc99a7d03c3dcf9b49cde534ee86fe88cd7a412039edd0'
    'JsonStringSerializer.cs' = 'e910166a61aeba751fac47562d154a381e155384d884474eac9bd43b86b4cf4e'
    'JsonTextSurrogateValidator.cs' = '61d919b8cc2ecec7144a567f51339fb47dd2a6df521e25c1790f9f1b4d6a1a43'
    'LICENSE' = '8e027d0ebfb96b3d3f425b5398a723f04ed21a3d33ab8d346f6f10ff9142bfaa'
}

$visibilityChanges = @{
    'JcsException.cs' = @(
        'internal sealed class JcsException',
        'public sealed class JcsException'
    )
    'JsonCanonicalizer.cs' = @(
        'internal static class JsonCanonicalizer',
        'public static class JsonCanonicalizer'
    )
}

function ConvertTo-Lf {
    param([Parameter(Mandatory)] [string] $Text)

    return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Get-Sha256 {
    param([Parameter(Mandatory)] [string] $Text)

    $bytes = $utf8.GetBytes($Text)
    return [Convert]::ToHexString(
        [System.Security.Cryptography.SHA256]::HashData($bytes)
    ).ToLowerInvariant()
}

foreach ($entry in $expectedHashes.GetEnumerator()) {
    $path = Join-Path $sourceRoot $entry.Key
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Vendored Jcs.Net file is missing: $($entry.Key)"
    }

    $text = ConvertTo-Lf ([System.IO.File]::ReadAllText($path))
    if ($entry.Key -ne 'LICENSE') {
        if (-not $text.StartsWith($headerBoundary, 'Ordinal')) {
            throw "Vendored attribution header is missing from $($entry.Key)"
        }

        $secondBoundary = $text.IndexOf(
            $headerBoundary,
            $headerBoundary.Length,
            [System.StringComparison]::Ordinal)
        if ($secondBoundary -lt 0) {
            throw "Vendored attribution header is malformed in $($entry.Key)"
        }

        $text = $text.Substring($secondBoundary + $headerBoundary.Length)

        if ($visibilityChanges.ContainsKey($entry.Key)) {
            $change = $visibilityChanges[$entry.Key]
            if (-not $text.Contains($change[0], 'Ordinal')) {
                throw "Documented visibility change is missing from $($entry.Key)"
            }
            $text = $text.Replace($change[0], $change[1], 'Ordinal')
        }
    }

    $actual = Get-Sha256 $text
    if ($actual -ne $entry.Value) {
        throw "Vendored Jcs.Net provenance mismatch for $($entry.Key): expected $($entry.Value), got $actual"
    }
}

Write-Host 'Vendored Jcs.Net provenance verified.'
