#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Packs the WorldCut .NET port and proves both packages work from a clean,
    isolated NuGet feed.

.DESCRIPTION
    This script is the packaging gate for ports/dotnet. It:

      1. packs WorldCut and WorldCut.Tool into a local feed;
      2. asserts each package contains exactly the allowed files;
      3. builds and runs an isolated library consumer on .NET 8 and .NET 10 and
         compares the verification-record digest with the committed conformance
         vector;
      4. installs the dotnet tool from the local feed and checks the CLI
         fixture output and every documented exit code;
      5. runs the packaged net8.0 tool asset directly so both shipped target
         frameworks are exercised.

    The isolated workspace deliberately shadows Directory.Build.props,
    Directory.Packages.props, and NuGet.config so the consumer sees only what a
    real customer would see.

.PARAMETER Dotnet
    The dotnet host to use. Defaults to `dotnet` from PATH.

.PARAMETER Configuration
    The build configuration to pack. Defaults to Release.
#>

[CmdletBinding()]
param(
    [string] $Dotnet = 'dotnet',
    [string] $Configuration = 'Release',
    [string] $ArtifactDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$portRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $portRoot)
$workspace = Join-Path $portRoot '.package-smoke'
$feed = Join-Path $workspace 'feed'
$packageVersion = '0.1.1'

# An installed tool's apphost resolves its runtime through DOTNET_ROOT or the
# machine-wide install. When an explicit dotnet host is supplied from a private
# location, point both at it so the smoke test exercises the same runtime that
# produced the packages. A `shared` directory identifies a real dotnet root; a
# symlink such as /usr/bin/dotnet is left alone.
$resolvedDotnet = Get-Command $Dotnet -ErrorAction SilentlyContinue
if ($null -ne $resolvedDotnet -and [System.IO.Path]::IsPathRooted($resolvedDotnet.Source)) {
    $dotnetRoot = Split-Path -Parent $resolvedDotnet.Source
    if (Test-Path -LiteralPath (Join-Path $dotnetRoot 'shared')) {
        $env:DOTNET_ROOT = $dotnetRoot
        $env:PATH = "$dotnetRoot$([System.IO.Path]::PathSeparator)$env:PATH"
    }
}

$libraryAllowlist = @(
    '_rels/.rels',
    '[Content_Types].xml',
    'WorldCut.nuspec',
    'README.md',
    'THIRD-PARTY-NOTICES.md',
    'lib/net8.0/WorldCut.dll',
    'lib/net8.0/WorldCut.xml',
    'lib/net10.0/WorldCut.dll',
    'lib/net10.0/WorldCut.xml'
)

$toolAllowlist = @(
    '_rels/.rels',
    '[Content_Types].xml',
    'WorldCut.Tool.nuspec',
    'README.md',
    'THIRD-PARTY-NOTICES.md'
)
foreach ($framework in @('net8.0', 'net10.0')) {
    $toolAllowlist += @(
        "tools/$framework/any/DotnetToolSettings.xml",
        "tools/$framework/any/WorldCut.Tool.deps.json",
        "tools/$framework/any/WorldCut.Tool.dll",
        "tools/$framework/any/WorldCut.Tool.pdb",
        "tools/$framework/any/WorldCut.Tool.runtimeconfig.json",
        "tools/$framework/any/WorldCut.Tool.xml",
        "tools/$framework/any/WorldCut.dll",
        "tools/$framework/any/WorldCut.pdb",
        "tools/$framework/any/WorldCut.xml"
    )
}

function Invoke-Step {
    param(
        [Parameter(Mandatory)] [string] $Name,
        [Parameter(Mandatory)] [scriptblock] $Body
    )

    Write-Host "==> $Name" -ForegroundColor Cyan
    $global:LASTEXITCODE = 0
    & $Body
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE"
    }
}

function Assert-True {
    param(
        [Parameter(Mandatory)] [bool] $Condition,
        [Parameter(Mandatory)] [string] $Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-PackageEntry {
    param([Parameter(Mandatory)] [string] $Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        return @($archive.Entries | ForEach-Object { $_.FullName })
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-PackageContent {
    param(
        [Parameter(Mandatory)] [string] $Path,
        [Parameter(Mandatory)] [string[]] $Allowed
    )

    $entries = Get-PackageEntry -Path $Path
    $ignored = 'package/services/metadata/core-properties/'

    $actual = @($entries | Where-Object { -not $_.StartsWith($ignored, 'Ordinal') })
    $unexpected = @($actual | Where-Object { $Allowed -notcontains $_ })
    $missing = @($Allowed | Where-Object { $actual -notcontains $_ })

    if ($unexpected.Count -gt 0) {
        throw "$Path contains unexpected files: $($unexpected -join ', ')"
    }
    if ($missing.Count -gt 0) {
        throw "$Path is missing expected files: $($missing -join ', ')"
    }

    foreach ($entry in $actual) {
        foreach ($forbidden in @('.cs', '.csproj', '.sln', 'packages.lock.json', '.user')) {
            if ($entry.EndsWith($forbidden, 'Ordinal')) {
                throw "$Path leaks build or source content: $entry"
            }
        }
    }

    Write-Host "    $([System.IO.Path]::GetFileName($Path)): $($actual.Count) files, allowlist satisfied"
}

function Get-ExpectedDigest {
    $vectorPath = Join-Path $repoRoot 'conformance/0.1/verification-vectors.json'
    $vectors = Get-Content -Raw -LiteralPath $vectorPath | ConvertFrom-Json
    $coherent = $vectors.cases | Where-Object { $_.name -eq 'coherent' }
    Assert-True ($null -ne $coherent) 'the coherent conformance vector is missing'
    return $coherent.expected.verificationRecordDigest
}

function New-IsolatedWorkspace {
    if (Test-Path -LiteralPath $workspace) {
        Remove-Item -Recurse -Force -LiteralPath $workspace
    }
    New-Item -ItemType Directory -Path $workspace | Out-Null
    New-Item -ItemType Directory -Path $feed | Out-Null

    # Shadow every inherited MSBuild and NuGet setting so the consumer sees the
    # package exactly as a customer would.
    Set-Content -LiteralPath (Join-Path $workspace 'Directory.Build.props') -Value '<Project />' -NoNewline
    Set-Content -LiteralPath (Join-Path $workspace 'Directory.Build.targets') -Value '<Project />' -NoNewline
    Set-Content -LiteralPath (Join-Path $workspace 'Directory.Packages.props') -Value '<Project />' -NoNewline
    Set-Content -LiteralPath (Join-Path $workspace 'global.json') -Value '{}' -NoNewline

    $feedPath = (Resolve-Path -LiteralPath $feed).Path
    $nugetConfig = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <clear />
    <add key="local" value="$feedPath" />
    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />
  </packageSources>
  <packageSourceMapping>
    <clear />
    <packageSource key="local">
      <package pattern="WorldCut*" />
    </packageSource>
    <packageSource key="nuget.org">
      <package pattern="*" />
    </packageSource>
  </packageSourceMapping>
</configuration>
"@
    Set-Content -LiteralPath (Join-Path $workspace 'NuGet.config') -Value $nugetConfig
}

function New-LibraryConsumer {
    $consumer = Join-Path $workspace 'library-consumer'
    New-Item -ItemType Directory -Path $consumer | Out-Null

    $project = @"
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFrameworks>net8.0;net10.0</TargetFrameworks>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <RootNamespace>LibraryConsumer</RootNamespace>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="WorldCut" Version="$packageVersion" />
  </ItemGroup>
</Project>
"@
    Set-Content -LiteralPath (Join-Path $consumer 'LibraryConsumer.csproj') -Value $project

    $program = @'
using WorldCut;
using WorldCut.Json;

byte[] source = File.ReadAllBytes(args[0]);

ParsedVerificationInput input = ParsedVerificationInput.ParseUtf8(source);
VerificationResult first = WorldCutVerifier.Verify(input);
VerificationResult second = WorldCutVerifier.Verify(input);

if (first.VerificationRecordDigest != second.VerificationRecordDigest)
{
    Console.Error.WriteLine("repeated verification changed the digest");
    return 1;
}

if (CanonicalJson.Serialize(JsonValue.Parse("{\"z\":1,\"a\":2}")) != "{\"a\":2,\"z\":1}")
{
    Console.Error.WriteLine("canonicalization is wrong");
    return 1;
}

try
{
    WorldCutVerifier.VerifyJson("not json");
    Console.Error.WriteLine("invalid input was accepted");
    return 1;
}
catch (WorldCutException error) when (error.WireCode == "WORLDCUT_INVALID_INPUT")
{
}

Console.WriteLine(WorldCutProtocol.ProtocolVersion);
Console.WriteLine(WorldCutProtocol.EngineVersion);
Console.WriteLine(WorldCutProtocol.Canonicalization);
Console.WriteLine(first.Verdict.ToWireName());
Console.WriteLine(first.VerificationRecordDigest);
return 0;
'@
    Set-Content -LiteralPath (Join-Path $consumer 'Program.cs') -Value $program

    return $consumer
}

$expectedDigest = Get-ExpectedDigest
$coherentFixture = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'examples/coherent-deployment.json')).Path
$mismatchFixture = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'examples/git-ci-mismatch.json')).Path

Invoke-Step 'Verify vendored Jcs.Net provenance' {
    & (Join-Path $PSScriptRoot 'verify-vendored-source.ps1')
}

Invoke-Step 'Create the isolated workspace' { New-IsolatedWorkspace }

Invoke-Step 'Pack WorldCut and WorldCut.Tool into the local feed' {
    & $Dotnet pack (Join-Path $portRoot 'WorldCut.sln') `
        --configuration $Configuration `
        --output $feed `
        -p:ContinuousIntegrationBuild=true
}

Invoke-Step 'Validate package contents' {
    Assert-PackageContent -Path (Join-Path $feed "WorldCut.$packageVersion.nupkg") -Allowed $libraryAllowlist
    Assert-PackageContent -Path (Join-Path $feed "WorldCut.Tool.$packageVersion.nupkg") -Allowed $toolAllowlist
    Assert-True (Test-Path -LiteralPath (Join-Path $feed "WorldCut.$packageVersion.snupkg")) 'the library symbol package is missing'
    $global:LASTEXITCODE = 0
}

$consumer = New-LibraryConsumer
$consumerProject = Join-Path $consumer 'LibraryConsumer.csproj'

Invoke-Step 'Restore the isolated library consumer' {
    & $Dotnet restore $consumerProject
}

foreach ($framework in @('net8.0', 'net10.0')) {
    Invoke-Step "Run the isolated library consumer on $framework" {
        $output = & $Dotnet run --project $consumerProject --framework $framework --no-restore -- $coherentFixture
        if ($LASTEXITCODE -ne 0) {
            throw "the library consumer failed on $framework"
        }

        $lines = @($output)
        Assert-True ($lines.Count -ge 5) "the library consumer printed $($lines.Count) lines on $framework"
        Assert-True ($lines[-5] -eq '0.1') 'the consumer reported an unexpected protocol version'
        Assert-True ($lines[-4] -eq '0.1.2') 'the consumer reported an unexpected engine version'
        Assert-True ($lines[-3] -eq 'worldcut-json-v1') 'the consumer reported an unexpected canonicalization'
        Assert-True ($lines[-2] -eq 'CONTRACT_SATISFIED') 'the consumer reported an unexpected verdict'
        Assert-True ($lines[-1] -eq $expectedDigest) "the consumer digest does not match the conformance vector on $framework"
        $global:LASTEXITCODE = 0
    }
}

$toolPath = Join-Path $workspace 'tools'

Invoke-Step 'Install the dotnet tool from the local feed' {
    # --add-source cannot be combined with package source mapping, so the
    # isolated NuGet.config supplies the local feed instead.
    & $Dotnet tool install WorldCut.Tool `
        --version $packageVersion `
        --tool-path $toolPath `
        --configfile (Join-Path $workspace 'NuGet.config')
}

$toolExecutable = Join-Path $toolPath 'worldcut-dotnet'
if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform(
        [System.Runtime.InteropServices.OSPlatform]::Windows)) {
    $toolExecutable = "$toolExecutable.exe"
}

Invoke-Step 'Check the installed CLI' {
    Assert-True (Test-Path -LiteralPath $toolExecutable) "the tool was not installed at $toolExecutable"

    $help = & $toolExecutable --help
    Assert-True ($LASTEXITCODE -eq 0) '--help must exit with 0'
    Assert-True (($help -join "`n") -match 'worldcut-dotnet') '--help must describe the command'

    $satisfied = & $toolExecutable $coherentFixture
    Assert-True ($LASTEXITCODE -eq 0) 'a satisfied contract must exit with 0'
    $result = ($satisfied -join "`n") | ConvertFrom-Json
    Assert-True ($result.verdict -eq 'CONTRACT_SATISFIED') 'the CLI reported an unexpected verdict'
    Assert-True ($result.engineVersion -eq '0.1.2') 'the CLI reported an unexpected engine version'
    Assert-True ($result.verificationRecordDigest -eq $expectedDigest) 'the CLI digest does not match the conformance vector'

    & $toolExecutable --require-satisfied $coherentFixture | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) '--require-satisfied must exit with 0 for a satisfied contract'

    & $toolExecutable --require-satisfied $mismatchFixture | Out-Null
    Assert-True ($LASTEXITCODE -eq 2) '--require-satisfied must exit with 2 for a violated contract'

    $errorOutput = & $toolExecutable --not-a-flag 2>&1
    Assert-True ($LASTEXITCODE -eq 1) 'an unknown option must exit with 1'
    $envelope = ($errorOutput -join "`n") | ConvertFrom-Json
    Assert-True ($envelope.error.code -eq 'WORLDCUT_INVALID_ARGUMENT') 'an unknown option must report WORLDCUT_INVALID_ARGUMENT'

    $missingOutput = & $toolExecutable (Join-Path $workspace 'missing.json') 2>&1
    Assert-True ($LASTEXITCODE -eq 1) 'a missing file must exit with 1'
    $missingEnvelope = ($missingOutput -join "`n") | ConvertFrom-Json
    Assert-True ($missingEnvelope.error.code -eq 'WORLDCUT_FILE_READ_FAILED') 'a missing file must report WORLDCUT_FILE_READ_FAILED'

    $global:LASTEXITCODE = 0
}

Invoke-Step 'Run the packaged net8.0 tool asset directly' {
    $extracted = Join-Path $workspace 'tool-net8'
    if (Test-Path -LiteralPath $extracted) {
        Remove-Item -Recurse -Force -LiteralPath $extracted
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory(
        (Join-Path $feed "WorldCut.Tool.$packageVersion.nupkg"),
        $extracted)

    $assembly = Join-Path $extracted 'tools/net8.0/any/WorldCut.Tool.dll'
    Assert-True (Test-Path -LiteralPath $assembly) 'the net8.0 tool asset is missing'

    $output = & $Dotnet $assembly $coherentFixture
    Assert-True ($LASTEXITCODE -eq 0) 'the net8.0 tool asset must exit with 0'
    $result = ($output -join "`n") | ConvertFrom-Json
    Assert-True ($result.verificationRecordDigest -eq $expectedDigest) 'the net8.0 tool asset produced a different digest'

    $global:LASTEXITCODE = 0
}

if ($ArtifactDirectory) {
    Invoke-Step 'Copy verified package artifacts' {
        $resolvedArtifacts = [System.IO.Path]::GetFullPath(
            $ArtifactDirectory,
            $portRoot)
        if (Test-Path -LiteralPath $resolvedArtifacts) {
            $existing = @(Get-ChildItem -LiteralPath $resolvedArtifacts -Force)
            if ($existing.Count -gt 0) {
                throw "ArtifactDirectory must be empty: $resolvedArtifacts"
            }
        }
        else {
            New-Item -ItemType Directory -Path $resolvedArtifacts | Out-Null
        }
        Copy-Item -LiteralPath (Join-Path $feed "WorldCut.$packageVersion.nupkg") `
            -Destination $resolvedArtifacts
        Copy-Item -LiteralPath (Join-Path $feed "WorldCut.$packageVersion.snupkg") `
            -Destination $resolvedArtifacts
        Copy-Item -LiteralPath (Join-Path $feed "WorldCut.Tool.$packageVersion.nupkg") `
            -Destination $resolvedArtifacts
        $global:LASTEXITCODE = 0
    }
}

Write-Host ''
Write-Host 'Package smoke test passed.' -ForegroundColor Green
