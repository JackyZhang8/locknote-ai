package main

import "testing"

func TestDesktopCloseWaitsOnlyForAnInitializedFrontend(t *testing.T) {
	var state desktopCloseState
	if state.preventClose() {
		t.Fatal("uninitialized frontend must not trap window close")
	}
	state.frontendStarted()
	if !state.preventClose() {
		t.Fatal("initialized frontend must finish its save check")
	}
	state.saveFinished()
	if state.preventClose() {
		t.Fatal("frontend acknowledged close must proceed")
	}
}
