package worldcut

import "fmt"

const InvalidInputCode = "WORLDCUT_INVALID_INPUT"

type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string {
	return e.Message
}

func invalidInput(format string, args ...any) error {
	return &Error{
		Code:    InvalidInputCode,
		Message: fmt.Sprintf(format, args...),
	}
}

func ErrorCode(err error) string {
	if worldCutError, ok := err.(*Error); ok {
		return worldCutError.Code
	}
	return ""
}
