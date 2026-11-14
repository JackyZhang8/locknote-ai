package main

import "sync"

// A frontend that failed to start cannot acknowledge a save-before-close event.
// Only wait after the workspace has installed its close handler.
type desktopCloseState struct {
	mu            sync.Mutex
	frontendReady bool
	closeReady    bool
}

func (s *desktopCloseState) frontendStarted() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frontendReady = true
}

func (s *desktopCloseState) saveFinished() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closeReady = true
}

func (s *desktopCloseState) preventClose() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.frontendReady && !s.closeReady
}
