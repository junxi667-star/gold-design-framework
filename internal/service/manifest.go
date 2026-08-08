package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/crypto/sha3"
	"golang.org/x/text/unicode/norm"

	"jewelchain-studio/internal/model"
)

func keccakHex(value []byte) string {
	hash := sha3.NewLegacyKeccak256()
	_, _ = hash.Write(value)
	return "0x" + hex.EncodeToString(hash.Sum(nil))
}

func sha256Hex(value []byte) string { hash := sha256.Sum256(value); return hex.EncodeToString(hash[:]) }

// canonicalJSON deliberately mirrors the legacy canonical manifest: map keys
// sort lexically, strings normalize to NFC, and array order is retained.
func canonicalJSON(value any) ([]byte, error) {
	var builder strings.Builder
	if err := appendCanonicalJSON(&builder, value); err != nil {
		return nil, err
	}
	return []byte(builder.String()), nil
}

func hashCanonical(value any) (string, error) {
	bytes, err := canonicalJSON(value)
	if err != nil {
		return "", err
	}
	return keccakHex(bytes), nil
}

func appendCanonicalJSON(builder *strings.Builder, value any) error {
	switch typed := value.(type) {
	case nil:
		builder.WriteString("null")
	case bool:
		if typed {
			builder.WriteString("true")
		} else {
			builder.WriteString("false")
		}
	case string:
		builder.Write(jsonString(norm.NFC.String(typed)))
	case json.Number:
		value, err := typed.Float64()
		if err != nil {
			return err
		}
		return appendCanonicalJSON(builder, value)
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return fmt.Errorf("non-finite number is not allowed in canonical JSON")
		}
		builder.WriteString(jsNumber(typed))
	case float32:
		if math.IsNaN(float64(typed)) || math.IsInf(float64(typed), 0) {
			return fmt.Errorf("non-finite number is not allowed in canonical JSON")
		}
		builder.WriteString(jsNumber(float64(typed)))
	case int:
		builder.WriteString(strconv.Itoa(typed))
	case int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		builder.WriteString(fmt.Sprint(typed))
	case model.Record:
		return appendCanonicalMap(builder, map[string]any(typed))
	case map[string]any:
		return appendCanonicalMap(builder, typed)
	case []any:
		builder.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				builder.WriteByte(',')
			}
			if err := appendCanonicalJSON(builder, item); err != nil {
				return err
			}
		}
		builder.WriteByte(']')
	case []string:
		builder.WriteByte('[')
		for index, item := range typed {
			if index > 0 {
				builder.WriteByte(',')
			}
			builder.Write(jsonString(norm.NFC.String(item)))
		}
		builder.WriteByte(']')
	default:
		bytes, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("unsupported canonical value: %w", err)
		}
		var normal any
		if err := json.Unmarshal(bytes, &normal); err != nil {
			return err
		}
		return appendCanonicalJSON(builder, normal)
	}
	return nil
}

func appendCanonicalMap(builder *strings.Builder, value map[string]any) error {
	type entry struct {
		key   string
		value any
	}
	entries := make([]entry, 0, len(value))
	seen := make(map[string]struct{}, len(value))
	for key, item := range value {
		normalized := norm.NFC.String(key)
		if _, exists := seen[normalized]; exists {
			return fmt.Errorf("canonical JSON key collision after NFC normalization: %q", normalized)
		}
		seen[normalized] = struct{}{}
		entries = append(entries, entry{key: normalized, value: item})
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].key < entries[right].key })
	builder.WriteByte('{')
	for index, entry := range entries {
		if index > 0 {
			builder.WriteByte(',')
		}
		builder.Write(jsonString(entry.key))
		builder.WriteByte(':')
		if err := appendCanonicalJSON(builder, entry.value); err != nil {
			return err
		}
	}
	builder.WriteByte('}')
	return nil
}

func jsonString(value string) []byte {
	encoded, _ := json.Marshal(value)
	encoded = []byte(strings.NewReplacer("\\u003c", "<", "\\u003e", ">", "\\u0026", "&", "\\u2028", "\u2028", "\\u2029", "\u2029").Replace(string(encoded)))
	return encoded
}

func jsNumber(value float64) string {
	if value == 0 {
		return "0"
	}
	abs := math.Abs(value)
	if abs >= 1e21 || abs < 1e-6 {
		text := strconv.FormatFloat(value, 'e', -1, 64)
		base, exponent, _ := strings.Cut(text, "e")
		negative := strings.HasPrefix(exponent, "-")
		exponent = strings.TrimLeft(exponent, "+-0")
		if exponent == "" {
			exponent = "0"
		}
		if negative {
			return base + "e-" + exponent
		}
		return base + "e+" + exponent
	}
	return strconv.FormatFloat(value, 'f', -1, 64)
}

func buildMetadata(project, version model.Record, registrant, imageURI string) (model.Record, error) {
	imagePath := model.String(version, "imageFilePath")
	image, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, model.NewError("VERSION_NOT_READY", "版本缺少真实图片或提示词", 409, false, nil)
	}
	apiPrompt := model.String(version, "apiPrompt")
	if apiPrompt == "" {
		return nil, model.NewError("VERSION_NOT_READY", "版本缺少真实图片或提示词", 409, false, nil)
	}
	requirement := model.RecordValue(version, "structuredRequirement")
	requirementHash, err := hashCanonical(requirement)
	if err != nil {
		return nil, err
	}
	if imageURI == "" {
		imageURI = model.String(version, "imageUrl")
	}
	shape := firstNonBlank(model.String(requirement, "shape"), firstString(model.Strings(requirement["structureForms"])))
	metadata := model.Record{
		"schemaVersion": "jewelchain-design/v1", "canonicalization": "sorted-object-keys+nfc-strings/json/utf-8/v1", "localDesignId": model.String(project, "localDesignId"),
		"version": model.Int(version, "versionNumber"), "parentContentHash": firstNonBlank(model.String(version, "parentContentHash"), zeroHash), "registrant": normalizeAddress(registrant),
		"productType": model.String(requirement, "productType"), "shape": shape, "style": model.String(requirement, "style"), "motifs": model.Strings(requirement["motifs"]), "surfaceEffects": model.Strings(requirement["surfaceEffects"]), "targetAudience": model.String(requirement, "targetAudience"), "usageScenario": model.String(requirement, "usageScenario"), "changeRequest": model.String(version, "changeRequest"),
		"requirementHash": requirementHash, "promptHash": keccakHex([]byte(norm.NFC.String(apiPrompt))), "imageHash": keccakHex(image), "imageSha256": sha256Hex(image), "imageSizeBytes": len(image), "imageUri": imageURI,
		"modelProvider": model.String(version, "modelProvider"), "modelName": model.String(version, "modelName"), "reviewStatus": "customer-confirmed", "generatedAt": model.String(version, "createdAt"), "declarationType": "registrant-declaration", "legalNotice": "链上记录证明内容指纹、提交地址与时间，不替代版权登记、原创性审查或法律认定。",
	}
	return metadata, nil
}

func absolutePublicURL(baseURL, path string) string {
	if baseURL == "" || !strings.HasPrefix(path, "/") {
		return path
	}
	return strings.TrimRight(baseURL, "/") + path
}
