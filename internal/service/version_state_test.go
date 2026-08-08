package service

import "testing"

func TestVersionStateTransitions(t *testing.T) {
	if !CanTransitionVersion("generating", "awaiting_confirmation") || !CanTransitionVersion("tx_submitted", "registration_failed") || !CanTransitionVersion("chain_confirmed", "finalized") {
		t.Fatal("expected legal version transitions")
	}
	if CanTransitionVersion("generating", "chain_confirmed") || CanTransitionVersion("finalized", "chain_confirmed") {
		t.Fatal("accepted an illegal version transition")
	}
	if !CanTransitionVersion("chain_confirmed", "chain_confirmed") || !IsVersionState("finalized") || IsVersionState("unknown") {
		t.Fatal("state membership or idempotent transition is wrong")
	}
	if err := assertVersionTransition("generating", "finalized"); err == nil {
		t.Fatal("expected invalid transition error")
	}
}
