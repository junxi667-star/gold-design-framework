package service

import (
	"strings"
	"testing"
)

func TestCanonicalManifestUsesLegacyKeccakAndSortedKeys(t *testing.T) {
	if actual := keccakHex([]byte{}); actual != "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470" {
		t.Fatalf("unexpected empty Keccak: %s", actual)
	}
	first, err := canonicalJSON(map[string]any{"z": "last", "a": "first"})
	if err != nil {
		t.Fatal(err)
	}
	if string(first) != `{"a":"first","z":"last"}` {
		t.Fatalf("unexpected canonical JSON: %s", first)
	}
	bytes32 := func(value string) string { return "0x" + strings.Repeat("0", 63) + value }
	if data, err := encodeRegister(bytes32("1"), bytes32("2"), bytes32("3"), "https://example.test/metadata.json"); err != nil || data[:10] != "0x6258b181" {
		t.Fatalf("register ABI selector is not compatible: %q, %v", data, err)
	}
}

func TestCanonicalManifestRejectsNormalizedKeyCollisionAndKeepsJavaScriptSeparators(t *testing.T) {
	if _, err := canonicalJSON(map[string]any{"é": "first", "e\u0301": "second"}); err == nil {
		t.Fatal("canonical JSON accepted NFC-colliding keys")
	}
	encoded, err := canonicalJSON(map[string]any{"text": "before\u2028after\u2029done"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "\\u2028") || strings.Contains(string(encoded), "\\u2029") {
		t.Fatalf("canonical JSON escaped JavaScript line separators: %q", encoded)
	}
}

func TestABIEncodingRejectsMalformedBytes32(t *testing.T) {
	valid := "0x" + strings.Repeat("0", 63) + "1"
	for _, testCase := range []struct {
		name  string
		value string
	}{
		{name: "short", value: "0x01"},
		{name: "long", value: "0x" + strings.Repeat("1", 65)},
		{name: "not hex", value: "0x" + strings.Repeat("z", 64)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := encodeRegister(valid, testCase.value, valid, "https://example.test/metadata.json"); err == nil {
				t.Fatalf("accepted malformed bytes32 %q", testCase.value)
			}
		})
	}
}
