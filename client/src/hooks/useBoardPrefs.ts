import { useCallback, useEffect, useState } from 'react';

const KEY = 'ce-board-prefs-v1';

type BoardPrefs = {
  wipLimits: Record<string, number>;     // stageId -> limit（无 key = 不限制）
  collapsedLanes: string[];              // 折叠的泳道 key
};

const EMPTY: BoardPrefs = { wipLimits: {}, collapsedLanes: [] };

function read(): BoardPrefs {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const p = JSON.parse(raw);
    return { wipLimits: p.wipLimits ?? {}, collapsedLanes: p.collapsedLanes ?? [] };
  } catch { return EMPTY; }
}

export function useBoardPrefs() {
  const [prefs, setPrefs] = useState<BoardPrefs>(read);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore quota */ }
  }, [prefs]);

  const setWipLimit = useCallback((stageId: string, limit: number | null) => {
    setPrefs((p) => {
      const next = { ...p.wipLimits };
      if (limit == null || limit <= 0) delete next[stageId];
      else next[stageId] = limit;
      return { ...p, wipLimits: next };
    });
  }, []);

  const toggleLane = useCallback((laneKey: string) => {
    setPrefs((p) => {
      const has = p.collapsedLanes.includes(laneKey);
      return { ...p, collapsedLanes: has ? p.collapsedLanes.filter((k) => k !== laneKey) : [...p.collapsedLanes, laneKey] };
    });
  }, []);

  return {
    wipLimits: prefs.wipLimits,
    collapsedLanes: prefs.collapsedLanes,
    isLaneCollapsed: (k: string) => prefs.collapsedLanes.includes(k),
    setWipLimit,
    toggleLane,
  };
}
