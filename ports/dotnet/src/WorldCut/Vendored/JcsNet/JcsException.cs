// -----------------------------------------------------------------------------
// Vendored third-party source. This file is NOT original WorldCut code.
//
// Source:    Jcs.NET 0.1.1 - https://github.com/IsraelIyonsi/Jcs.NET
// Commit:    8aff61685300d5d94b81f05246f95d4681e7178a
// Copyright: Copyright (c) 2026 Israel Iyonsi
// License:   MIT (see the LICENSE file next to this source)
//
// WorldCut modifications are limited to this header and to the changes listed
// in ports/dotnet/THIRD-PARTY-NOTICES.md. Do not edit for style; upstream
// fidelity is deliberate.
// -----------------------------------------------------------------------------
using System.Text.Json;

namespace Jcs.Net;

/// <summary>
/// Thrown when input cannot be canonicalized under RFC 8785: invalid JSON,
/// numbers outside the IEEE 754 double range (NaN, Infinity), duplicate
/// object member names, or unpaired UTF-16 surrogates in string data.
/// </summary>
internal sealed class JcsException : JsonException
{
    /// <summary>Initializes the exception with a message describing the violation.</summary>
    /// <param name="message">Description of the RFC 8785 constraint that was violated.</param>
    public JcsException(string message) : base(message)
    {
    }

    /// <summary>Initializes the exception with a message and the underlying failure.</summary>
    /// <param name="message">Description of the RFC 8785 constraint that was violated.</param>
    /// <param name="innerException">The original exception raised by the JSON reader.</param>
    public JcsException(string message, Exception innerException) : base(message, innerException)
    {
    }
}
