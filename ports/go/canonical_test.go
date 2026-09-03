package worldcut

import (
	"math"
	"testing"
)

func TestCanonicalJSONUsesUTF16Ordering(t *testing.T) {
	value := map[string]any{
		"\ue000":     1,
		"\U00010000": 2,
	}
	canonical, err := CanonicalJSON(value)
	if err != nil {
		t.Fatal(err)
	}
	if string(canonical) != `{"𐀀":2,"":1}` {
		t.Fatalf("unexpected UTF-16 ordering: %s", canonical)
	}
}

func TestCanonicalJSONRejectsNonFiniteNumbers(t *testing.T) {
	for _, value := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		if _, err := CanonicalJSON(map[string]any{"value": value}); err == nil {
			t.Fatalf("CanonicalJSON accepted %v", value)
		}
	}
}

func TestRawUnicodeRejectsUnpairedSurrogates(t *testing.T) {
	for _, source := range [][]byte{
		[]byte(`"\ud800"`),
		[]byte(`"\udc00"`),
		[]byte(`"\ud800\u0041"`),
	} {
		if err := validateRawUnicode(source); err == nil {
			t.Fatalf("accepted invalid Unicode: %s", source)
		}
	}
	if err := validateRawUnicode([]byte(`"\ud83d\ude00"`)); err != nil {
		t.Fatalf("rejected valid surrogate pair: %v", err)
	}
}
