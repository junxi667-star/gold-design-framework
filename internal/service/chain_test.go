package service

import (
	"encoding/hex"
	"fmt"
	"strings"
	"testing"

	"jewelchain-studio/internal/model"
)

func TestMatchingRegistrationEventReturnsNodeCompatibleFields(t *testing.T) {
	designID := strings.Repeat("1", 64)
	contentHash := strings.Repeat("2", 64)
	parentHash := "0x" + strings.Repeat("3", 64)
	contract := "0x017ba6a7b6d90387bc588ad6fccdf2e0fd16d8b7"
	registeredBy := "0x1111111111111111111111111111111111111111"
	metadataURI := "https://metadata.example/design.json"
	data := registerEventData(7, registeredBy, metadataURI)
	receipt := model.Record{"logs": []any{map[string]any{
		"address": contract,
		"topics": []any{
			keccakHex([]byte("VersionRegistered(bytes32,bytes32,bytes32,uint64,address,string)")),
			"0x" + designID,
			"0x" + contentHash,
			parentHash,
		},
		"data": data,
	}}}
	event := matchingEvent(receipt, "register", designID, contentHash, parentHash, metadataURI, contract)
	if event == nil {
		t.Fatal("expected matching registration event")
	}
	if model.String(event, "event") != "VersionRegistered" || model.String(event, "designId") != "0x"+designID || model.String(event, "contentHash") != "0x"+contentHash || model.String(event, "parentContentHash") != parentHash {
		t.Fatalf("incomplete registration event: %#v", event)
	}
	if model.Int(event, "versionNumber") != 7 || model.String(event, "registeredBy") != registeredBy || model.String(event, "metadataUri") != metadataURI {
		t.Fatalf("unexpected decoded registration event: %#v", event)
	}
}

func TestRegistryEventRejectsInvalidDynamicOffsetWithoutPanicking(t *testing.T) {
	data := "0x" + abiWord(1) + abiAddressWord("0x1111111111111111111111111111111111111111") + strings.Repeat("f", 64)
	if event := decodeRegistryEvent("register", data); event != nil {
		t.Fatalf("malformed offset produced event: %#v", event)
	}
}

func registerEventData(version int, address, metadataURI string) string {
	payload := hex.EncodeToString([]byte(metadataURI))
	payload += strings.Repeat("0", (64-len(payload)%64)%64)
	return "0x" + abiWord(version) + abiAddressWord(address) + abiWord(96) + abiWord(len(metadataURI)) + payload
}

func abiWord(value int) string { return fmt.Sprintf("%064x", value) }

func abiAddressWord(address string) string {
	return strings.Repeat("0", 24) + strings.TrimPrefix(strings.ToLower(address), "0x")
}
