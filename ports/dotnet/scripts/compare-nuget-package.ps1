#!/usr/bin/env pwsh

[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $LocalPath,
    [Parameter(Mandatory)] [string] $PublishedPath,
    [string] $Dotnet = 'dotnet',
    [switch] $SkipSignatureVerification
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ContentMap {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [bool] $ExcludeRepositorySignature
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead(
        [System.IO.Path]::GetFullPath($Path))
    try {
        $map = [ordered]@{}
        foreach ($entry in $archive.Entries) {
            if ($entry.FullName.EndsWith('/', 'Ordinal')) {
                continue
            }
            if ($ExcludeRepositorySignature -and
                $entry.FullName -eq '.signature.p7s') {
                continue
            }
            if ($entry.FullName.StartsWith(
                    'package/services/metadata/core-properties/',
                    'Ordinal')) {
                continue
            }

            $stream = $entry.Open()
            try {
                $hash = [System.Security.Cryptography.SHA256]::HashData($stream)
                $map[$entry.FullName] = [Convert]::ToHexString($hash).ToLowerInvariant()
            }
            finally {
                $stream.Dispose()
            }
        }
        return $map
    }
    finally {
        $archive.Dispose()
    }
}

$local = [System.IO.Path]::GetFullPath($LocalPath)
$published = [System.IO.Path]::GetFullPath($PublishedPath)
if (-not (Test-Path -LiteralPath $local -PathType Leaf)) {
    throw "Local NuGet package is missing: $local"
}
if (-not (Test-Path -LiteralPath $published -PathType Leaf)) {
    throw "Published NuGet package is missing: $published"
}

$publishedEntries = Get-ContentMap -Path $published -ExcludeRepositorySignature $false
if (-not $publishedEntries.Contains('.signature.p7s')) {
    throw "Published NuGet package has no repository signature: $published"
}

if (-not $SkipSignatureVerification) {
    & $Dotnet nuget verify $published --all
    if ($LASTEXITCODE -ne 0) {
        throw "NuGet signature verification failed for $published"
    }
}

$localEntries = Get-ContentMap -Path $local -ExcludeRepositorySignature $true
$publishedContent = Get-ContentMap -Path $published -ExcludeRepositorySignature $true

$localKeys = @($localEntries.Keys)
$publishedKeys = @($publishedContent.Keys)
$missing = @($localKeys | Where-Object { -not $publishedContent.Contains($_) })
$extra = @($publishedKeys | Where-Object { -not $localEntries.Contains($_) })
$changed = @(
    $localKeys | Where-Object {
        $publishedContent.Contains($_) -and
        $localEntries[$_] -ne $publishedContent[$_]
    }
)
if ($missing.Count -gt 0 -or $extra.Count -gt 0 -or $changed.Count -gt 0) {
    throw "Published NuGet content differs from the tested package. Missing: $($missing -join ', '); extra: $($extra -join ', '); changed: $($changed -join ', ')"
}

Write-Host "Verified repository-signed NuGet package content: $published"
