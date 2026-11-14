import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { activityService } from '@/services/activityService';
import { useToast } from '@/store/ToastContext';
import { invalidateStats } from '@/store/StatsContext';

export interface PomodoroState {
  isActive: boolean;
  mode: 'work' | 'break';
  durationMinutes: number;
  endsAt: number | null; // epoch timestamp ms
  remainingSeconds: number;
  sessionId?: string | null;
  sessionStart?: number | null;
}

interface PomodoroContextValue extends PomodoroState {
  startTimer: (durationMinutes?: number, mode?: 'work' | 'break') => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  resetTimer: () => void;
  toggleTimer: () => void;
  setMode: (mode: 'work' | 'break') => void;
}

const STORAGE_KEY = 'cadence_pomodoro_state_v1';

const PomodoroContext = createContext<PomodoroContextValue | null>(null);

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast();

  const [state, setState] = useState<PomodoroState>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.endsAt && parsed.isActive) {
          const rem = Math.max(0, Math.round((parsed.endsAt - Date.now()) / 1000));
          return {
            ...parsed,
            remainingSeconds: rem,
            isActive: rem > 0,
            sessionId: parsed.sessionId || `focus_${parsed.endsAt}`,
            sessionStart: parsed.sessionStart || (parsed.endsAt - (parsed.durationMinutes || 25) * 60000),
          };
        }
        return parsed;
      }
    } catch {
      // Fallback
    }
    return {
      isActive: false,
      mode: 'work',
      durationMinutes: 25,
      endsAt: null,
      remainingSeconds: 25 * 60,
      sessionId: null,
      sessionStart: null,
    };
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  const sessionIdRef = useRef<string | null>(state.sessionId || null);
  const sessionStartRef = useRef<number | null>(state.sessionStart || null);
  const recordedSessionIdRef = useRef<string | null>(null);

  // Helper to record focus time if session was active for at least 1 minute (60s)
  const recordFocusSession = async (completedNormally = false) => {
    if (stateRef.current.mode !== 'work') return;
    const sessionId = stateRef.current.sessionId || sessionIdRef.current || `focus_${stateRef.current.endsAt || Date.now()}`;
    if (!sessionId || recordedSessionIdRef.current === sessionId) return;

    const startMs =
      stateRef.current.sessionStart ||
      sessionStartRef.current ||
      (stateRef.current.endsAt ? stateRef.current.endsAt - stateRef.current.durationMinutes * 60000 : Date.now());
    const elapsedSecs = Math.max(0, Math.round((Date.now() - startMs) / 1000));

    // Must be at least 1 minute (60 seconds)
    if (elapsedSecs < 60 && !completedNormally) {
      return;
    }

    const elapsedMinutes = completedNormally
      ? stateRef.current.durationMinutes
      : Math.max(1, Math.round(elapsedSecs / 60));

    recordedSessionIdRef.current = sessionId;

    try {
      await activityService.recordFocus(sessionId, elapsedMinutes);
      invalidateStats();
    } catch (err) {
      console.error('[PomodoroContext] Failed to record focus:', err);
    }
  };

  // Keepalive delivery when page closes
  useEffect(() => {
    const handleUnload = () => {
      if (stateRef.current.isActive && stateRef.current.mode === 'work') {
        const sessionId = stateRef.current.sessionId || sessionIdRef.current;
        if (!sessionId || recordedSessionIdRef.current === sessionId) return;
        const startMs = stateRef.current.sessionStart || sessionStartRef.current;
        if (!startMs) return;
        const elapsedSecs = Math.max(0, Math.round((Date.now() - startMs) / 1000));
        if (elapsedSecs >= 60) {
          const elapsedMinutes = Math.max(1, Math.round(elapsedSecs / 60));
          const token = localStorage.getItem('nova_auth_token');
          const payload = JSON.stringify({
            sessionId,
            durationMinutes: elapsedMinutes,
            timezone: activityService.getUserTimezone(),
            localDate: activityService.getUserLocalDate(),
          });
          const url = `${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/activity/focus`;
          fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: payload,
            keepalive: true,
          }).catch(() => {});
        }
      }
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, []);

  // Persist state changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore
    }
  }, [state]);

  // Check for expired session on mount (completed while tab was closed)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.isActive && parsed.endsAt && parsed.endsAt <= Date.now() && parsed.mode === 'work') {
          const sId = parsed.sessionId || `focus_${parsed.endsAt}`;
          activityService
            .recordFocus(sId, parsed.durationMinutes || 25)
            .then(() => {
              invalidateStats();
            })
            .catch(() => {});
        }
      }
    } catch {
      // Ignore
    }
  }, []);

  // Handle completion audio & activity log
  const handleComplete = async (completedMode: 'work' | 'break', duration: number) => {
    // Play sound safely
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.setValueAtTime(880, audioCtx.currentTime + 0.15); // A5
      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.6);
    } catch {
      // Audio not permitted or supported
    }

    if (completedMode === 'work') {
      showToast('Focus session complete! Take a well-deserved break.', 'success');
      await recordFocusSession(true);
      // Auto-switch to break
      const breakSecs = 5 * 60;
      setState({
        isActive: false,
        mode: 'break',
        durationMinutes: 5,
        endsAt: null,
        remainingSeconds: breakSecs,
        sessionId: null,
        sessionStart: null,
      });
    } else {
      showToast('Break finished! Ready to focus again?', 'info');
      const workSecs = 25 * 60;
      setState({
        isActive: false,
        mode: 'work',
        durationMinutes: 25,
        endsAt: null,
        remainingSeconds: workSecs,
        sessionId: null,
        sessionStart: null,
      });
    }
  };

  // Main countdown ticker based on Date.now()
  useEffect(() => {
    if (!state.isActive || !state.endsAt) {
      return;
    }

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.round((state.endsAt! - now) / 1000));

      if (diff <= 0) {
        clearInterval(interval);
        handleComplete(state.mode, state.durationMinutes);
      } else {
        setState((prev) => ({ ...prev, remainingSeconds: diff }));
      }
    }, 500);

    return () => clearInterval(interval);
  }, [state.isActive, state.endsAt, state.mode, state.durationMinutes]);

  // Update document title with remaining time
  useEffect(() => {
    if (state.isActive) {
      const m = Math.floor(state.remainingSeconds / 60);
      const s = state.remainingSeconds % 60;
      const f = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
      document.title = `(${f}) Cadence - ${state.mode === 'work' ? 'Focus' : 'Break'}`;
    } else {
      document.title = 'Cadence — AI Learning Assistant & Study Planner';
    }
  }, [state.isActive, state.remainingSeconds, state.mode]);

  const startTimer = (durationMinutes = state.durationMinutes, mode: 'work' | 'break' = state.mode) => {
    const totalSecs = durationMinutes * 60;
    const endsAt = Date.now() + totalSecs * 1000;
    const newSessionId = mode === 'work' ? `focus_${Date.now()}` : null;
    const newSessionStart = mode === 'work' ? Date.now() : null;
    if (mode === 'work') {
      sessionIdRef.current = newSessionId;
      sessionStartRef.current = newSessionStart;
      recordedSessionIdRef.current = null;
    }
    setState({
      isActive: true,
      mode,
      durationMinutes,
      endsAt,
      remainingSeconds: totalSecs,
      sessionId: newSessionId,
      sessionStart: newSessionStart,
    });
  };

  const pauseTimer = () => {
    if (!state.isActive) return;
    recordFocusSession(false);
    setState((prev) => ({
      ...prev,
      isActive: false,
      endsAt: null,
    }));
  };

  const resumeTimer = () => {
    if (state.isActive) return;
    const endsAt = Date.now() + state.remainingSeconds * 1000;
    setState((prev) => ({
      ...prev,
      isActive: true,
      endsAt,
    }));
  };

  const resetTimer = () => {
    recordFocusSession(false);
    const totalSecs = state.durationMinutes * 60;
    setState((prev) => ({
      ...prev,
      isActive: false,
      endsAt: null,
      remainingSeconds: totalSecs,
    }));
  };

  const toggleTimer = () => {
    if (state.isActive) {
      pauseTimer();
    } else {
      resumeTimer();
    }
  };

  const setMode = (mode: 'work' | 'break') => {
    const duration = mode === 'work' ? 25 : 5;
    setState({
      isActive: false,
      mode,
      durationMinutes: duration,
      endsAt: null,
      remainingSeconds: duration * 60,
    });
  };

  return (
    <PomodoroContext.Provider
      value={{
        ...state,
        startTimer,
        pauseTimer,
        resumeTimer,
        resetTimer,
        toggleTimer,
        setMode,
      }}
    >
      {children}
    </PomodoroContext.Provider>
  );
}

export function usePomodoro(): PomodoroContextValue {
  const ctx = useContext(PomodoroContext);
  if (!ctx) {
    throw new Error('usePomodoro must be used within a PomodoroProvider');
  }
  return ctx;
}

