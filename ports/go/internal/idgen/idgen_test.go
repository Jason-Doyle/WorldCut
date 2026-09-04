package idgen

import (
	"regexp"
	"testing"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func TestUUIDv4IsCanonicalAndUnique(t *testing.T) {
	seen := make(map[string]bool, 512)
	for i := 0; i < 512; i++ {
		value, err := UUIDv4()
		if err != nil {
			t.Fatal(err)
		}
		if !uuidPattern.MatchString(value) {
			t.Fatalf("identifier %q is not a canonical version 4 UUID", value)
		}
		if seen[value] {
			t.Fatalf("identifier %q was generated twice", value)
		}
		seen[value] = true
	}
}
