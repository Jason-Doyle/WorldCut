package worldcut

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"reflect"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/gowebpki/jcs"
)

func compareUTF16(left, right string) int {
	leftUnits := utf16.Encode([]rune(left))
	rightUnits := utf16.Encode([]rune(right))
	limit := len(leftUnits)
	if len(rightUnits) < limit {
		limit = len(rightUnits)
	}
	for i := 0; i < limit; i++ {
		if leftUnits[i] < rightUnits[i] {
			return -1
		}
		if leftUnits[i] > rightUnits[i] {
			return 1
		}
	}
	switch {
	case len(leftUnits) < len(rightUnits):
		return -1
	case len(leftUnits) > len(rightUnits):
		return 1
	default:
		return 0
	}
}

type canonicalVisit struct {
	kind reflect.Kind
	ptr  uintptr
}

func validateCanonicalValue(value reflect.Value, field string, ancestors map[canonicalVisit]bool) error {
	if !value.IsValid() {
		return nil
	}
	if value.Kind() == reflect.Interface {
		if value.IsNil() {
			return nil
		}
		return validateCanonicalValue(value.Elem(), field, ancestors)
	}
	switch value.Kind() {
	case reflect.Bool:
		return nil
	case reflect.String:
		if !utf8.ValidString(value.String()) {
			return fmt.Errorf("%s contains invalid Unicode", field)
		}
		return nil
	case reflect.Float32, reflect.Float64:
		number := value.Float()
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return fmt.Errorf("%s contains a non-finite number", field)
		}
		return nil
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return nil
	case reflect.Pointer:
		if value.IsNil() {
			return nil
		}
		visit := canonicalVisit{kind: value.Kind(), ptr: value.Pointer()}
		if ancestors[visit] {
			return fmt.Errorf("%s must not contain cycles", field)
		}
		ancestors[visit] = true
		err := validateCanonicalValue(value.Elem(), field, ancestors)
		delete(ancestors, visit)
		return err
	case reflect.Slice:
		if value.IsNil() {
			return nil
		}
		if value.Type().Elem().Kind() == reflect.Uint8 {
			return fmt.Errorf("%s contains unsupported byte data", field)
		}
		visit := canonicalVisit{kind: value.Kind(), ptr: value.Pointer()}
		if ancestors[visit] {
			return fmt.Errorf("%s must not contain cycles", field)
		}
		ancestors[visit] = true
		defer delete(ancestors, visit)
		fallthrough
	case reflect.Array:
		for i := 0; i < value.Len(); i++ {
			if err := validateCanonicalValue(value.Index(i), fmt.Sprintf("%s[%d]", field, i), ancestors); err != nil {
				return err
			}
		}
		return nil
	case reflect.Map:
		if value.Type().Key().Kind() != reflect.String {
			return fmt.Errorf("%s must use string object keys", field)
		}
		if value.IsNil() {
			return nil
		}
		visit := canonicalVisit{kind: value.Kind(), ptr: value.Pointer()}
		if ancestors[visit] {
			return fmt.Errorf("%s must not contain cycles", field)
		}
		ancestors[visit] = true
		defer delete(ancestors, visit)
		iter := value.MapRange()
		for iter.Next() {
			key := iter.Key().String()
			if !utf8.ValidString(key) {
				return fmt.Errorf("%s contains an invalid Unicode key", field)
			}
			if err := validateCanonicalValue(iter.Value(), field+"."+key, ancestors); err != nil {
				return err
			}
		}
		return nil
	case reflect.Struct:
		valueType := value.Type()
		for i := 0; i < value.NumField(); i++ {
			structField := valueType.Field(i)
			if structField.PkgPath != "" {
				continue
			}
			tag := strings.Split(structField.Tag.Get("json"), ",")[0]
			if tag == "-" {
				continue
			}
			name := structField.Name
			if tag != "" {
				name = tag
			}
			if err := validateCanonicalValue(value.Field(i), field+"."+name, ancestors); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("%s contains unsupported %s data", field, value.Kind())
	}
}

func CanonicalJSON(value any) ([]byte, error) {
	if err := validateCanonicalValue(reflect.ValueOf(value), "value", map[canonicalVisit]bool{}); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("encode JSON data: %w", err)
	}
	canonical, err := jcs.Transform(encoded)
	if err != nil {
		return nil, fmt.Errorf("canonicalize JSON data: %w", err)
	}
	return canonical, nil
}

func SHA256Digest(value any) (string, error) {
	canonical, err := CanonicalJSON(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}
