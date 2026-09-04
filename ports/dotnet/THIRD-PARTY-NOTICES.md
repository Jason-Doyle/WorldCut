# Third-party notices — WorldCut .NET port

The `WorldCut` NuGet package has **no third-party package dependencies**. It
does, however, contain vendored third-party source code. That source is listed
here in full, with its licence and the exact modifications WorldCut applied.

---

## Jcs.NET 0.1.1 (MIT)

| Field | Value |
| --- | --- |
| Project | Jcs.NET |
| Upstream | <https://github.com/IsraelIyonsi/Jcs.NET> |
| Version | 0.1.1 |
| Commit | `8aff61685300d5d94b81f05246f95d4681e7178a` |
| Licence | MIT |
| Copyright | Copyright (c) 2026 Israel Iyonsi |
| Vendored to | `src/WorldCut/Vendored/JcsNet/` |

Jcs.NET implements RFC 8785 (JSON Canonicalization Scheme). WorldCut's
`worldcut-json-v1` canonicalization is defined in terms of the same RFC 8785
rules, so WorldCut uses this implementation as its canonical serializer rather
than writing a fourth independent ECMAScript number formatter.

### Why the source is vendored instead of referenced

* The `WorldCut` package keeps a zero-dependency install graph, which matters
  for a verification library used inside deployment gates.
* The exact canonicalization bytes are protocol-normative. Pinning the source
  by commit removes any possibility of a transitive package upgrade silently
  changing a verification-record digest.
* Vendoring keeps the audited implementation reviewable inside this repository.

### Files vendored

The following files were copied from `src/Jcs.Net/` at the commit above. The
SHA-256 values identify the raw **upstream** files; they are not hashes of the
vendored copies, which contain the documented attribution and visibility
changes. `scripts/verify-vendored-source.ps1` reverses those exact changes and
checks the reconstructed bytes against these values.

| File | Upstream SHA-256 |
| --- | --- |
| `CanonicalJsonSerializer.cs` | `3e9083f0273c29cebbc2e6e12eee9ce083580862a310e5b198ff9f8f0c624375` |
| `EcmaScriptNumberFormatter.cs` | `6f4f63a52d7e5f39a27efbbd14d8f095d7480ddbe4c455653778b0aedb1eb2fb` |
| `JcsException.cs` | `78156a3dc02aa98065446f4eb81fb34f2c24ad9687d99ff7dc0a395746a3ea4c` |
| `JsonCanonicalizer.cs` | `dd8c55948053399755cc99a7d03c3dcf9b49cde534ee86fe88cd7a412039edd0` |
| `JsonStringSerializer.cs` | `e910166a61aeba751fac47562d154a381e155384d884474eac9bd43b86b4cf4e` |
| `JsonTextSurrogateValidator.cs` | `61d919b8cc2ecec7144a567f51339fb47dd2a6df521e25c1790f9f1b4d6a1a43` |

`src/WorldCut/Vendored/JcsNet/LICENSE` is the upstream MIT licence text,
unmodified.

### Modifications applied by WorldCut

1. A twelve-line attribution header was prepended to each `.cs` file. It names
   the upstream project, version, commit, copyright holder, and licence, and
   states that the file is not original WorldCut code.
2. `JsonCanonicalizer` was changed from `public static class` to
   `internal static class`.
3. `JcsException` was changed from `public sealed class` to
   `internal sealed class`.

Changes 2 and 3 exist so that the `WorldCut` package does not re-export another
project's public API surface under the `Jcs.Net` namespace, which would collide
for consumers that also reference the real `Jcs.Net` package. No behaviour,
algorithm, message, or limit was altered. Line endings were normalised to LF to
match this repository.

### WorldCut policy around the vendored code

WorldCut does not call the vendored code directly from its public API. It sits
behind `WorldCut.Json.CanonicalJson`, which adds the behaviour WorldCut's
protocol requires and the vendored library deliberately does not provide:

* **Unpaired-surrogate pre-validation owned by WorldCut.** `System.Text.Json`
  substitutes `U+FFFD` for unpaired UTF-16 surrogates when *writing*. WorldCut
  therefore rejects every unpaired surrogate code unit — raw or `\uXXXX`
  escaped — before any value reaches canonicalization or verification, so a
  malformed string can never be silently repaired into a different digest.
* **Duplicate JSON member handling.** RFC 8785 rejects duplicate object member
  names. WorldCut's protocol follows `JSON.parse`/`json.loads` last-value-wins
  semantics, so WorldCut deduplicates while parsing and the vendored duplicate
  check is never reached.
* **A documented nesting limit.** `CanonicalJsonSerializer` caps nesting at 64
  levels and throws `JcsException`. WorldCut adopts that cap as an explicit,
  stable port policy: canonicalization accepts at most
  `WorldCutProtocol.MaxCanonicalizationDepth` (64) levels of nesting, and
  parsing accepts at most `WorldCutProtocol.MaxJsonDepth` (48). The parsing
  limit is lower on purpose, because the verification record wraps input values
  in up to eight further levels; the difference guarantees that any input the
  port accepts can always be canonicalized.
* **Structured errors.** Every `JsonException` (including `JcsException`) that
  can escape the vendored code is translated into a `WorldCutException` with a
  stable WorldCut error code. No `Jcs.Net` type is observable from the WorldCut
  public API.

### Upstream licence

```text
MIT License

Copyright (c) 2026 Israel Iyonsi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

WorldCut itself is licensed under the Apache License 2.0; see the repository
[`LICENSE`](../../LICENSE).
