package worldcut

import (
	"errors"
	"fmt"
)

// Stable error codes shared with the other WorldCut implementations.
const (
	InvalidInputCode          = "WORLDCUT_INVALID_INPUT"
	GitHubAPIErrorCode        = "WORLDCUT_GITHUB_API_ERROR"
	GitHubResponseInvalidCode = "WORLDCUT_GITHUB_RESPONSE_INVALID"
	ADKResolutionInvalidCode  = "WORLDCUT_ADK_RESOLUTION_INVALID"
)

// Error is a WorldCut error carrying a stable machine-readable code.
type Error struct {
	Code    string
	Message string
	Cause   error
}

func (e *Error) Error() string {
	if e.Cause == nil {
		return e.Message
	}
	return e.Message + ": " + e.Cause.Error()
}

// Unwrap exposes the underlying operational error, when one exists.
func (e *Error) Unwrap() error {
	return e.Cause
}

// NewError builds a WorldCut error with the supplied stable code.
func NewError(code, message string) *Error {
	return &Error{Code: code, Message: message}
}

// WrapError builds a WorldCut error that preserves an underlying cause.
func WrapError(code, message string, cause error) *Error {
	return &Error{Code: code, Message: message, Cause: cause}
}

func invalidInput(format string, args ...any) error {
	return &Error{
		Code:    InvalidInputCode,
		Message: fmt.Sprintf(format, args...),
	}
}

// ErrorCode reports the stable WorldCut code for err, or an empty string when
// err was not produced by this module.
func ErrorCode(err error) string {
	var worldCutError *Error
	if errors.As(err, &worldCutError) {
		return worldCutError.Code
	}
	return ""
}
