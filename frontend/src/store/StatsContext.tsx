import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { statsService, type StatsSummary } from '@/services/statsService';
import { activityService, type ActivityResponse } from '@/services/activityService';
import { useAuth } from '@/store/AuthContext';
import { getSocket } from '@/services/socket';

interface StatsContextValue {
  stats: StatsSummary | null;
  activityData: ActivityResponse | null;
  loading: boolean;
  error: string | null;
  refreshStats: () => Promise<void>;
}

const StatsContext = createContext<StatsContextValue | null>(null);

// Global listeners for direct mutation invalidation outside React component hierarchy
type InvalidateListener = () => void;
const invalidateListeners = new Set<InvalidateListener>();

export function invalidateStats(): void {
  for (const listener of invalidateListeners) {
    try {
      listener();
    } catch (err) {
      console.error('[StatsContext] Invalidate listener error:', err);
    }
  }
}

export function StatsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [activityData, setActivityData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAllStats = useCallback(async () => {
    if (!user) {
      setStats(null);
      setActivityData(null);
      setLoading(false);
      setError(null);
      return;
    }

    try {
      setError(null);
      const [newStats, newActivity] = await Promise.all([
        statsService.getSummary(),
        activityService.getActivity(),
      ]);
      setStats(newStats);
      setActivityData(newActivity);
    } catch (err: unknown) {
      console.error('[StatsContext] Failed to load stats:', err);
      const msg = err instanceof Error ? err.message : 'Failed to connect to stats service';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial fetch and user changes (triggers daily checkin on app load)
  useEffect(() => {
    if (user) {
      setLoading(true);
      activityService
        .checkin()
        .catch(() => {})
        .finally(() => {
          fetchAllStats();
        });
    } else {
      setStats(null);
      setActivityData(null);
      setLoading(false);
      setError(null);
    }
  }, [user, fetchAllStats]);

  // Window focus / visibility change refetch & daily checkin
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && user) {
        activityService.checkin().catch(() => {});
        fetchAllStats();
      }
    };
    window.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);
    return () => {
      window.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, [user, fetchAllStats]);

  // Periodic polling every 2 minutes
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(() => {
      fetchAllStats();
    }, 120_000);
    return () => clearInterval(interval);
  }, [user, fetchAllStats]);

  // Socket.IO real-time invalidation
  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const handleInvalidate = () => {
      fetchAllStats();
    };

    socket.on('stats:invalidate', handleInvalidate);
    return () => {
      socket.off('stats:invalidate', handleInvalidate);
    };
  }, [user, fetchAllStats]);

  // Register with global invalidator
  useEffect(() => {
    const listener = () => {
      fetchAllStats();
    };
    invalidateListeners.add(listener);
    return () => {
      invalidateListeners.delete(listener);
    };
  }, [fetchAllStats]);

  return (
    <StatsContext.Provider
      value={{
        stats,
        activityData,
        loading,
        error,
        refreshStats: fetchAllStats,
      }}
    >
      {children}
    </StatsContext.Provider>
  );
}

export function useStats(): StatsContextValue {
  const ctx = useContext(StatsContext);
  if (!ctx) {
    throw new Error('useStats must be used within StatsProvider');
  }
  return ctx;
}

