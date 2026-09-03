package worldcut

import "testing"

func FuzzCanonicalJSONNoPanic(f *testing.F) {
	f.Add([]byte(`{"b":[true,null,1e30],"a":"text"}`))
	f.Add([]byte(`"\ud83d\ude00"`))
	f.Fuzz(func(t *testing.T, source []byte) {
		value, err := decodeJSON(source)
		if err != nil {
			return
		}
		first, err := CanonicalJSON(value)
		if err != nil {
			return
		}
		second, err := CanonicalJSON(value)
		if err != nil {
			t.Fatal(err)
		}
		if string(first) != string(second) {
			t.Fatalf("canonicalization is not deterministic: %q != %q", first, second)
		}
	})
}

func FuzzVerifierNoPanic(f *testing.F) {
	f.Add([]byte(`null`))
	f.Add([]byte(`{"protocolVersion":"0.1"}`))
	f.Fuzz(func(t *testing.T, source []byte) {
		_, _ = VerifyJSON(source)
	})
}
