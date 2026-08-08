package service

import "jewelchain-studio/internal/model"

// VersionStates is the persisted design-version lifecycle. Keep this in one
// place so worker completion, wallet preparation, submissions and receipt
// reconciliation cannot create an impossible chain history.
var VersionStates = []string{
	"generating",
	"generation_failed",
	"awaiting_confirmation",
	"awaiting_wallet_signature",
	"tx_submitted",
	"registration_failed",
	"chain_confirmed",
	"finalized",
}

var versionTransitions = map[string]map[string]struct{}{
	"generating":                {"awaiting_confirmation": {}, "generation_failed": {}},
	"generation_failed":         {"awaiting_confirmation": {}},
	"awaiting_confirmation":     {"awaiting_wallet_signature": {}},
	"awaiting_wallet_signature": {"awaiting_wallet_signature": {}, "tx_submitted": {}},
	"tx_submitted":              {"chain_confirmed": {}, "registration_failed": {}},
	"registration_failed":       {"awaiting_wallet_signature": {}},
	"chain_confirmed":           {"finalized": {}, "chain_confirmed": {}},
	"finalized":                 {"finalized": {}},
}

func IsVersionState(value string) bool {
	_, ok := versionTransitions[value]
	return ok
}

func CanTransitionVersion(from, to string) bool {
	if from == to {
		return IsVersionState(from)
	}
	transitions, ok := versionTransitions[from]
	if !ok {
		return false
	}
	_, ok = transitions[to]
	return ok
}

func assertVersionTransition(from, to string) error {
	if CanTransitionVersion(from, to) {
		return nil
	}
	return model.NewError("INVALID_VERSION_STATE", "版本状态不能从 "+from+" 变更为 "+to, 409, false, model.Record{"from": from, "to": to})
}
