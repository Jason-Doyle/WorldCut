# Publishing language ports

Go is distributed directly from the protected `ports/go/v*` module tags.
Python and .NET use registry-specific protected tag workflows:

| Port | Registry | Workflow | Environment | Tag |
| --- | --- | --- | --- | --- |
| Python | PyPI | `release-python.yml` | `pypi` | `ports/python/v*` |
| .NET | NuGet.org | `release-dotnet.yml` | `nuget` | `ports/dotnet/v*` |

Current registry status:

- .NET `0.1.1` is published as
  [`WorldCut`](https://www.nuget.org/packages/WorldCut/0.1.1) and
  [`WorldCut.Tool`](https://www.nuget.org/packages/WorldCut.Tool/0.1.1).
- Python `0.1.1` is published as
  [`worldcut`](https://pypi.org/project/worldcut/0.1.1/) with PEP 740 digital
  attestations for both the wheel and source distribution.

Both workflows:

- require an annotated protected tag whose version matches the package;
- require the tagged commit to belong to `main` and to have passed main CI;
- rebuild, test, package, and consume the artifacts in isolation;
- publish with GitHub OIDC rather than a long-lived registry token;
- verify registry artifact digests before creating a GitHub release.

The repository tag ruleset prevents creation, deletion, or rewriting of
`ports/*/v*` tags except through the release-maintainer bypass. The `pypi` and
`nuget` environments require approval from `@Jason-Doyle`; self-approval is
allowed so a solo maintainer is not deadlocked.

## PyPI trusted publisher

Before the first Python tag is pushed, add a pending publisher at
<https://pypi.org/manage/account/publishing/>:

| Field | Value |
| --- | --- |
| PyPI project | `worldcut` |
| GitHub owner | `Jason-Doyle` |
| Repository | `WorldCut` |
| Workflow | `release-python.yml` |
| Environment | `pypi` |

PyPI creates the project on the first successful OIDC publication. A pending
publisher does not reserve the name before that upload.

## NuGet.org trusted publisher

Before the first .NET tag is pushed:

1. Create or use the NuGet.org account that will own `WorldCut` and
   `WorldCut.Tool`.
2. Add a trusted publishing policy and select that user account as the policy
   owner:

| Field | Value |
| --- | --- |
| GitHub owner | `Jason-Doyle` |
| Repository | `WorldCut` |
| Workflow | `release-dotnet.yml` |
| Environment | `nuget` |
| Package scope | `WorldCut*` |
| Allowed actions | Publish new packages and new package versions |

3. Set the non-secret `NUGET_USER` variable on the repository's `nuget`
   environment to the NuGet.org username that created the policy.

The workflow uses the official `NuGet/login` action to exchange its GitHub OIDC
token for a short-lived NuGet API key immediately before upload.

For a private repository, NuGet.org may initially show the policy as pending
full activation for seven days. The first successful publish within that
window permanently binds it to the repository and owner IDs.
