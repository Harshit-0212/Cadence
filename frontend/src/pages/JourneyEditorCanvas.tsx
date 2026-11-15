/**
 * JourneyEditorCanvas.tsx
 *
 * Full-featured admin Journey Editor.
 * - SVG drag-and-drop canvas (no extra libs)
 * - Add / duplicate / delete stages
 * - Connect stages with wires (SVG cubic bezier)
 * - Side panel: edit title, description, icon, color, content
 * - Background control: presets, gradients, image upload
 * - Undo / redo (last 50 states)
 * - Snap-to-grid toggle
 * - Zoom / pan
 * - Save → POST to backend, Discard with confirmation
 * - Versioning: list + restore
 * - Real-time broadcast via Socket.IO (admin side listens too)
 * - Unsaved changes warning on page unload
 */
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useMemo,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Trash2,
  Copy,
  Undo2,
  Redo2,
  Save,
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GridIcon,
  ArrowLeft,
  Clock,
  Image,
  Palette,
  ChevronDown,
  ChevronRight,
  History,
  RotateCcw,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { journeyAdminService, type EditorStage, type EditorEdge, type JourneySettings } from '@/services/journeyAdminService';
import { journeyService } from '@/services/journeyService';
import { getSocket } from '@/services/socket';
import { useToast } from '@/store/ToastContext';

// ── Constants ──────────────────────────────────────────────────────────────

const GRID = 20;
const STAGE_W = 180;
const STAGE_H = 72;
const HANDLE_R = 8;

const ICON_OPTIONS = ['⚡', '🎯', '🧩', '📚', '🔬', '💡', '🏆', '🌟', '🔥', '🚀', '📊', '🧠', '🔧', '🎓', '📝'];
const COLOR_OPTIONS = [
  '#6542C5', '#E91E8C', '#00BCD4', '#4CAF50', '#FF9800',
  '#F44336', '#9C27B0', '#2196F3', '#009688', '#FF5722',
];
const GRADIENT_PRESETS = [
  { label: 'Aurora',    from: '#1a1a2e', to: '#16213e' },
  { label: 'Sunset',   from: '#2d1b69', to: '#11998e' },
  { label: 'Midnight', from: '#0f0c29', to: '#302b63' },
  { label: 'Forest',   from: '#134e5e', to: '#71b280' },
  { label: 'Candy',    from: '#fc5c7d', to: '#6a3093' },
  { label: 'Ocean',    from: '#1a3a4a', to: '#1b6ca8' },
];

// ── Types ──────────────────────────────────────────────────────────────────

interface CanvasState {
  stages: EditorStage[];
  edges: EditorEdge[];
  settings: JourneySettings;
}

interface HistoryState {
  past: CanvasState[];
  present: CanvasState;
  future: CanvasState[];
}

type HistoryAction =
  | { type: 'SET'; state: CanvasState }
  | { type: 'UNDO' }
  | { type: 'REDO' };

function historyReducer(h: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'SET': {
      const past = [...h.past, h.present].slice(-50);
      return { past, present: action.state, future: [] };
    }
    case 'UNDO': {
      if (!h.past.length) return h;
      const prev = h.past[h.past.length - 1];
      return { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] };
    }
    case 'REDO': {
      if (!h.future.length) return h;
      const next = h.future[0];
      return { past: [...h.past, h.present], present: next, future: h.future.slice(1) };
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

function uid(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cubicPath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.abs(x2 - x1) * 0.6;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Remove unused stageCenter helper (kept for reference in future)
function _stageCenter_unused(s: EditorStage) {
  return { cx: (s.x ?? 0) + STAGE_W / 2, cy: (s.y ?? 0) + STAGE_H / 2 };
}
void _stageCenter_unused;

function stageOutputHandle(s: EditorStage) {
  return { hx: (s.x ?? 0) + STAGE_W, hy: (s.y ?? 0) + STAGE_H / 2 };
}

function stageInputHandle(s: EditorStage) {
  return { hx: s.x ?? 0, hy: (s.y ?? 0) + STAGE_H / 2 };
}

function bgCss(settings: JourneySettings): React.CSSProperties {
  if (settings.backgroundType === 'uploaded' && settings.uploadedImageUrl) {
    return {
      backgroundImage: `url(${settings.uploadedImageUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  if (settings.backgroundType === 'preset' && settings.preset) {
    const p = GRADIENT_PRESETS.find((x) => x.label === settings.preset);
    if (p) return { background: `linear-gradient(135deg, ${p.from}, ${p.to})` };
  }
  const g = settings.gradient ?? { from: '#1a1a2e', to: '#16213e', angle: 135 };
  return { background: `linear-gradient(${g.angle}deg, ${g.from}, ${g.to})` };
}

const DEFAULT_SETTINGS: JourneySettings = {
  backgroundType: 'gradient',
  gradient: { from: '#1a1a2e', to: '#2d1b69', angle: 135 },
  overlayOpacity: 0.3,
  themeColors: { primary: '#6542C5', accent: '#E91E8C' },
};

// ── Main Component ─────────────────────────────────────────────────────────

export function JourneyEditorCanvas() {
  const { journeyId } = useParams<{ journeyId: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // ── Loading ───────────────────────────────────────────────────────────────
  const [bootstrapped, setBootstrapped] = useState(false);
  const [journeyTitle, setJourneyTitle] = useState('');

  // ── History (undo/redo) ───────────────────────────────────────────────────
  const [history, dispatch] = useReducer(historyReducer, {
    past: [],
    present: { stages: [], edges: [], settings: DEFAULT_SETTINGS },
    future: [],
  });
  const { present, past, future } = history;
  const { stages, edges, settings } = present;

  // ── Dirty tracking ────────────────────────────────────────────────────────
  const [savedState, setSavedState] = useState<CanvasState | null>(null);
  const isDirty = useMemo(() => {
    if (!savedState) return false;
    return JSON.stringify(present) !== JSON.stringify(savedState);
  }, [present, savedState]);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [saving, setSaving] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<Awaited<ReturnType<typeof journeyAdminService.listVersions>>>([]);
  const [bgPanel, setBgPanel] = useState(false);
  const [uploadingBg, setUploadingBg] = useState(false);

  // ── Wire drawing state ────────────────────────────────────────────────────
  const [wireFrom, setWireFrom] = useState<string | null>(null);
  const [wireMouse, setWireMouse] = useState<{ x: number; y: number } | null>(null);

  // ── Drag state ────────────────────────────────────────────────────────────
  const [dragging, setDragging] = useState<{ id: string; offX: number; offY: number } | null>(null);
  const [panDragging, setPanDragging] = useState<{ startX: number; startY: number; panX: number; panY: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);

  // ── Mutation helpers ──────────────────────────────────────────────────────
  const commit = useCallback(
    (next: Partial<CanvasState>) => {
      dispatch({ type: 'SET', state: { ...present, ...next } });
    },
    [present],
  );

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!journeyId) return;
    (async () => {
      try {
        const [graph, journeys] = await Promise.all([
          journeyAdminService.getJourneyGraph(journeyId),
          journeyService.listJourneys(),
        ]);
        const j = journeys.find((x) => x.id === journeyId || (x as unknown as { _id: string })._id === journeyId);
        setJourneyTitle(j?.title ?? 'Journey Editor');
        const initial: CanvasState = {
          stages: graph.stages,
          edges: graph.edges,
          settings: graph.settings ?? DEFAULT_SETTINGS,
        };
        dispatch({ type: 'SET', state: initial });
        // Replace the first "past" push so undo doesn't go below initial
        setSavedState(initial);
      } catch (err) {
        showToast(`Failed to load journey: ${(err as Error).message}`, 'error');
      } finally {
        setBootstrapped(true);
      }
    })();
  }, [journeyId, showToast]);

  // ── Unsaved changes warning ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); dispatch({ type: 'UNDO' }); }
      if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); dispatch({ type: 'REDO' }); }
      if (ctrl && e.key === 's') { e.preventDefault(); handleSave(); }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
        if (selectedStageId) deleteStage(selectedStageId);
        if (selectedEdgeId) deleteEdge(selectedEdgeId);
      }
      if (e.key === 'Escape') { setWireFrom(null); setSelectedStageId(null); setSelectedEdgeId(null); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStageId, selectedEdgeId, isDirty]);

  // ── Socket real-time ──────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const handler = (_data: { journeyId: string }) => {
      // Admin editor doesn't auto-reload to avoid overwriting unsaved work
      showToast('Another admin saved changes. Reload to get the latest.', 'info');
    };
    socket.on('journey:updated', handler);
    return () => { socket.off('journey:updated', handler); };
  }, [showToast]);

  // ── Canvas coord helpers ──────────────────────────────────────────────────
  const svgToCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan, zoom],
  );

  // ── Stage operations ──────────────────────────────────────────────────────
  const addStage = useCallback(() => {
    const id = uid();
    const newStage: EditorStage = {
      id,
      journeyId: journeyId!,
      title: 'New Stage',
      slug: `stage-${id}`,
      x: snapToGrid ? snap(pan.x + 200) : 200,
      y: snapToGrid ? snap(pan.y + 100) : 100,
      order: stages.length,
      color: COLOR_OPTIONS[stages.length % COLOR_OPTIONS.length],
      icon: ICON_OPTIONS[stages.length % ICON_OPTIONS.length],
      statusType: 'standard',
    };
    commit({ stages: [...stages, newStage] });
    setSelectedStageId(id);
    setSelectedEdgeId(null);
  }, [stages, commit, journeyId, snapToGrid, pan]);

  const duplicateStage = useCallback(
    (id: string) => {
      const src = stages.find((s) => s.id === id);
      if (!src) return;
      const newId = uid();
      const dup: EditorStage = {
        ...src,
        id: newId,
        slug: `stage-${newId}`,
        x: (src.x ?? 0) + 30,
        y: (src.y ?? 0) + 30,
        title: `${src.title} (copy)`,
      };
      commit({ stages: [...stages, dup] });
      setSelectedStageId(newId);
    },
    [stages, commit],
  );

  const deleteStage = useCallback(
    (id: string) => {
      commit({
        stages: stages.filter((s) => s.id !== id),
        edges: edges.filter((e) => e.fromStageId !== id && e.toStageId !== id),
      });
      if (selectedStageId === id) setSelectedStageId(null);
    },
    [stages, edges, commit, selectedStageId],
  );

  const updateStage = useCallback(
    (id: string, patch: Partial<EditorStage>) => {
      commit({ stages: stages.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
    },
    [stages, commit],
  );

  // ── Edge operations ───────────────────────────────────────────────────────
  const deleteEdge = useCallback(
    (id: string) => {
      commit({ edges: edges.filter((e) => e.id !== id) });
      if (selectedEdgeId === id) setSelectedEdgeId(null);
    },
    [edges, commit, selectedEdgeId],
  );

  const updateEdge = useCallback(
    (id: string, patch: Partial<EditorEdge>) => {
      commit({ edges: edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    },
    [edges, commit],
  );

  // ── Wire dragging ─────────────────────────────────────────────────────────
  const startWire = useCallback(
    (e: ReactPointerEvent, fromId: string) => {
      e.stopPropagation();
      setWireFrom(fromId);
      const pt = svgToCanvas(e.clientX, e.clientY);
      setWireMouse(pt);
    },
    [svgToCanvas],
  );

  const finishWire = useCallback(
    (toId: string) => {
      if (!wireFrom || wireFrom === toId) { setWireFrom(null); setWireMouse(null); return; }
      // Avoid duplicate
      const exists = edges.some(
        (e) => (e.fromStageId === wireFrom && e.toStageId === toId),
      );
      if (!exists) {
        const newEdge: EditorEdge = {
          id: uid(),
          fromStageId: wireFrom,
          toStageId: toId,
          style: 'curve',
          color: '#6542C5',
          animated: true,
        };
        commit({ edges: [...edges, newEdge] });
      }
      setWireFrom(null);
      setWireMouse(null);
    },
    [wireFrom, edges, commit],
  );

  // ── Pointer events on SVG ─────────────────────────────────────────────────
  const onSvgPointerMove = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (wireFrom) {
        setWireMouse(svgToCanvas(e.clientX, e.clientY));
        return;
      }
      if (dragging) {
        const { x, y } = svgToCanvas(e.clientX, e.clientY);
        let nx = x - dragging.offX;
        let ny = y - dragging.offY;
        if (snapToGrid) { nx = snap(nx); ny = snap(ny); }
        nx = Math.max(0, nx); ny = Math.max(0, ny);
        // Update directly in state without history (commit on pointer up)
        dispatch({
          type: 'SET',
          state: {
            ...present,
            stages: stages.map((s) => s.id === dragging.id ? { ...s, x: nx, y: ny } : s),
          },
        });
        return;
      }
      if (panDragging) {
        const dx = e.clientX - panDragging.startX;
        const dy = e.clientY - panDragging.startY;
        setPan({ x: panDragging.panX + dx, y: panDragging.panY + dy });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wireFrom, dragging, panDragging, svgToCanvas, snapToGrid, present, stages],
  );

  const onSvgPointerUp = useCallback(() => {
    setDragging(null);
    if (wireFrom) { setWireFrom(null); setWireMouse(null); }
    setPanDragging(null);
  }, [wireFrom]);

  const onSvgPointerDown = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      if (e.target === svgRef.current || (e.target as SVGElement).classList.contains('pan-target')) {
        setSelectedStageId(null);
        setSelectedEdgeId(null);
        if (wireFrom) { setWireFrom(null); setWireMouse(null); return; }
        setPanDragging({ startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y });
      }
    },
    [pan, wireFrom],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault();
      setZoom((z) => Math.min(2, Math.max(0.3, z - e.deltaY * 0.001)));
    },
    [],
  );

  // ── Stage drag start ──────────────────────────────────────────────────────
  const onStagePointerDown = useCallback(
    (e: ReactPointerEvent, id: string) => {
      e.stopPropagation();
      if (wireFrom) return; // drop handled separately
      setSelectedStageId(id);
      setSelectedEdgeId(null);
      const { x, y } = svgToCanvas(e.clientX, e.clientY);
      const stage = stages.find((s) => s.id === id);
      if (!stage) return;
      setDragging({ id, offX: x - (stage.x ?? 0), offY: y - (stage.y ?? 0) });
    },
    [wireFrom, svgToCanvas, stages],
  );

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  const fitView = useCallback(() => {
    if (!stages.length) return;
    const xs = stages.map((s) => s.x ?? 0);
    const ys = stages.map((s) => s.y ?? 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs) + STAGE_W;
    const maxY = Math.max(...ys) + STAGE_H;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scaleX = (rect.width - 80) / (maxX - minX || 1);
    const scaleY = (rect.height - 80) / (maxY - minY || 1);
    const newZoom = Math.min(1.5, Math.max(0.3, Math.min(scaleX, scaleY)));
    setZoom(newZoom);
    setPan({ x: 40 - minX * newZoom, y: 40 - minY * newZoom });
  }, [stages]);

  // ── Save ──────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!journeyId || saving) return;
    setSaving(true);
    try {
      const saved = await journeyAdminService.saveJourneyGraph(journeyId, {
        stages,
        edges,
        settings,
        description: `Saved at ${new Date().toLocaleTimeString()}`,
      });
      setSavedState({ stages: saved.stages, edges: saved.edges, settings: saved.settings });
      showToast('Journey saved!', 'success');
    } catch (err) {
      showToast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [journeyId, stages, edges, settings, saving, showToast]);

  // ── Discard ───────────────────────────────────────────────────────────────
  const handleDiscard = useCallback(() => {
    if (!savedState) return;
    if (isDirty && !window.confirm('Discard all unsaved changes?')) return;
    dispatch({ type: 'SET', state: savedState });
    showToast('Changes discarded.', 'info');
  }, [savedState, isDirty, showToast]);

  // ── Versions ──────────────────────────────────────────────────────────────
  const loadVersions = useCallback(async () => {
    if (!journeyId) return;
    try {
      const v = await journeyAdminService.listVersions(journeyId);
      setVersions(v);
    } catch {
      /* ignore */
    }
  }, [journeyId]);

  const restoreVersion = useCallback(
    async (versionId: string) => {
      if (!journeyId) return;
      if (!window.confirm('Restore this version? Unsaved changes will be lost.')) return;
      try {
        const graph = await journeyAdminService.restoreVersion(journeyId, versionId);
        const restored: CanvasState = { stages: graph.stages, edges: graph.edges, settings: graph.settings };
        dispatch({ type: 'SET', state: restored });
        setSavedState(restored);
        showToast('Version restored!', 'success');
        setShowVersions(false);
      } catch (err) {
        showToast(`Restore failed: ${(err as Error).message}`, 'error');
      }
    },
    [journeyId, showToast],
  );

  // ── Background upload ─────────────────────────────────────────────────────
  const handleBgUpload = useCallback(
    async (file: File) => {
      if (!journeyId) return;
      if (!file.type.startsWith('image/')) {
        showToast('Please upload an image file.', 'error'); return;
      }
      if (file.size > 2 * 1024 * 1024) {
        showToast('Image must be under 2 MB.', 'error'); return;
      }
      setUploadingBg(true);
      try {
        const { settings: newSettings } = await journeyAdminService.uploadBackgroundImage(journeyId, file);
        commit({ settings: newSettings });
        showToast('Background uploaded!', 'success');
      } catch (err) {
        showToast(`Upload failed: ${(err as Error).message}`, 'error');
      } finally {
        setUploadingBg(false);
      }
    },
    [journeyId, commit, showToast],
  );

  // ── Selected entities ─────────────────────────────────────────────────────
  const selectedStage = stages.find((s) => s.id === selectedStageId) ?? null;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;

  // ── Wire in progress ──────────────────────────────────────────────────────
  const wireFromStage = stages.find((s) => s.id === wireFrom);
  const wireStartPt = wireFromStage ? stageOutputHandle(wireFromStage) : null;

  // ── Render ────────────────────────────────────────────────────────────────
  if (!bootstrapped) {
    return (
      <AppLayout>
        <div className="flex h-[calc(100vh-8rem)] items-center justify-center">
          <Loader2 size={32} className="animate-spin text-[#6542C5]" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="flex flex-col h-[calc(100vh-4rem)] -m-4 sm:-m-6 lg:-m-8 overflow-hidden">

        {/* ── Top toolbar ── */}
        <div className="shrink-0 flex items-center gap-2 px-3 py-2 bg-[#1D1922] border-b border-white/10 z-20">
          <button
            onClick={() => {
              if (isDirty && !window.confirm('You have unsaved changes. Leave anyway?')) return;
              navigate(-1);
            }}
            className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-white/90 mr-2 truncate max-w-[200px]">
            {journeyTitle}
          </span>

          {isDirty && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">
              <AlertTriangle size={11} /> Unsaved
            </span>
          )}

          <div className="flex-1" />

          {/* Snap to grid */}
          <button
            onClick={() => setSnapToGrid((v) => !v)}
            title="Toggle snap-to-grid"
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              snapToGrid ? 'bg-[#6542C5] text-white' : 'text-white/60 hover:text-white hover:bg-white/10'
            }`}
          >
            <GridIcon size={14} />
            <span className="hidden sm:inline">Grid</span>
          </button>

          {/* Zoom */}
          <button onClick={() => setZoom((z) => Math.min(2, z + 0.1))} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Zoom in"><ZoomIn size={15} /></button>
          <span className="text-xs text-white/50 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.1))} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Zoom out"><ZoomOut size={15} /></button>
          <button onClick={fitView} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10" title="Fit view"><Maximize2 size={15} /></button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Undo / Redo */}
          <button disabled={!past.length} onClick={() => dispatch({ type: 'UNDO' })} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Undo (Ctrl+Z)"><Undo2 size={15} /></button>
          <button disabled={!future.length} onClick={() => dispatch({ type: 'REDO' })} className="p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30" title="Redo (Ctrl+Y)"><Redo2 size={15} /></button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Add stage */}
          <button
            onClick={addStage}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#6542C5] hover:bg-[#5233A8] text-white text-xs font-semibold transition-colors"
          >
            <Plus size={14} /> Add Stage
          </button>

          {/* Background */}
          <button
            onClick={() => setBgPanel((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${bgPanel ? 'bg-[#E91E8C]/20 text-[#E91E8C]' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            <Palette size={14} />
            <span className="hidden sm:inline">BG</span>
          </button>

          {/* Versions */}
          <button
            onClick={() => { setShowVersions((v) => !v); if (!showVersions) loadVersions(); }}
            className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${showVersions ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          >
            <History size={14} />
            <span className="hidden sm:inline">History</span>
          </button>

          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* Discard */}
          <button
            disabled={!isDirty}
            onClick={handleDiscard}
            className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            <X size={14} /> Discard
          </button>

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </button>
        </div>

        {/* ── Body: canvas + side panel ── */}
        <div className="flex flex-1 overflow-hidden relative">

          {/* ── Canvas ── */}
          <div className="flex-1 relative overflow-hidden" style={{ cursor: wireFrom ? 'crosshair' : panDragging ? 'grabbing' : 'grab' }}>
            {/* Background */}
            <div className="absolute inset-0" style={bgCss(settings)} />
            {/* Overlay for readability */}
            <div
              className="absolute inset-0 bg-black pointer-events-none"
              style={{ opacity: settings.overlayOpacity ?? 0.3 }}
            />

            {/* Grid dots */}
            {snapToGrid && (
              <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.15 }}>
                <defs>
                  <pattern id="grid" width={GRID * zoom} height={GRID * zoom} patternUnits="userSpaceOnUse" x={pan.x % (GRID * zoom)} y={pan.y % (GRID * zoom)}>
                    <circle cx={1} cy={1} r={1} fill="white" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#grid)" />
              </svg>
            )}

            {/* SVG canvas */}
            <svg
              ref={svgRef}
              className="absolute inset-0 w-full h-full select-none"
              onPointerDown={onSvgPointerDown}
              onPointerMove={onSvgPointerMove}
              onPointerUp={onSvgPointerUp}
              onPointerLeave={onSvgPointerUp}
              onWheel={onWheel}
              style={{ touchAction: 'none' }}
            >
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

                {/* Edges */}
                {edges.map((edge) => {
                  const from = stages.find((s) => s.id === edge.fromStageId);
                  const to = stages.find((s) => s.id === edge.toStageId);
                  if (!from || !to) return null;
                  const { hx: x1, hy: y1 } = stageOutputHandle(from);
                  const { hx: x2, hy: y2 } = stageInputHandle(to);
                  const d = cubicPath(x1, y1, x2, y2);
                  const isSelected = edge.id === selectedEdgeId;
                  const color = edge.color ?? '#6542C5';
                  return (
                    <g key={edge.id}>
                      {/* Wider invisible hit area */}
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={16}
                        onClick={() => { setSelectedEdgeId(edge.id); setSelectedStageId(null); }}
                        style={{ cursor: 'pointer' }}
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke={isSelected ? '#fff' : color}
                        strokeWidth={isSelected ? 3 : 2}
                        strokeDasharray={edge.style === 'dashed' ? '8 5' : undefined}
                        strokeLinecap="round"
                        opacity={0.9}
                      />
                      {/* Animated dot */}
                      {edge.animated && (
                        <circle r={4} fill={color} opacity={0.9}>
                          <animateMotion dur="2s" repeatCount="indefinite" path={d} />
                        </circle>
                      )}
                      {/* Arrow head */}
                      <circle cx={x2} cy={y2} r={4} fill={color} />
                    </g>
                  );
                })}

                {/* Wire in progress */}
                {wireFrom && wireStartPt && wireMouse && (
                  <path
                    d={cubicPath(wireStartPt.hx, wireStartPt.hy, wireMouse.x, wireMouse.y)}
                    fill="none"
                    stroke="white"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    strokeLinecap="round"
                    opacity={0.7}
                    className="pointer-events-none"
                  />
                )}

                {/* Stages */}
                {stages.map((stage) => {
                  const isSelected = stage.id === selectedStageId;
                  const sx = stage.x ?? 0;
                  const sy = stage.y ?? 0;
                  const color = stage.color ?? '#6542C5';
                  return (
                    <g
                      key={stage.id}
                      transform={`translate(${sx},${sy})`}
                      style={{ cursor: dragging?.id === stage.id ? 'grabbing' : 'grab' }}
                      onPointerDown={(e) => onStagePointerDown(e, stage.id)}
                      onPointerUp={() => { if (wireFrom && wireFrom !== stage.id) finishWire(stage.id); }}
                    >
                      {/* Shadow */}
                      <rect x={2} y={4} width={STAGE_W} height={STAGE_H} rx={12} fill="black" opacity={0.25} />

                      {/* Body */}
                      <rect
                        width={STAGE_W}
                        height={STAGE_H}
                        rx={12}
                        fill={color}
                        opacity={0.95}
                        stroke={isSelected ? '#fff' : 'transparent'}
                        strokeWidth={isSelected ? 2.5 : 0}
                      />

                      {/* Icon + title */}
                      <text x={14} y={28} fontSize={18} dominantBaseline="middle" textAnchor="start">
                        {stage.icon ?? '📚'}
                      </text>
                      <text x={40} y={26} fontSize={12} fontWeight="600" fill="white" dominantBaseline="middle" textAnchor="start" style={{ userSelect: 'none' }}>
                        {stage.title.length > 16 ? stage.title.slice(0, 15) + '…' : stage.title}
                      </text>
                      {stage.estimatedTime && (
                        <text x={40} y={48} fontSize={9} fill="white" opacity={0.75} dominantBaseline="middle">
                          ~{stage.estimatedTime}m
                        </text>
                      )}

                      {/* Input handle (left) */}
                      <circle
                        cx={0}
                        cy={STAGE_H / 2}
                        r={HANDLE_R}
                        fill="#1D1922"
                        stroke={color}
                        strokeWidth={2}
                        style={{ cursor: 'pointer' }}
                        onPointerUp={() => { if (wireFrom && wireFrom !== stage.id) finishWire(stage.id); }}
                      />

                      {/* Output handle (right) */}
                      <circle
                        cx={STAGE_W}
                        cy={STAGE_H / 2}
                        r={HANDLE_R}
                        fill="#1D1922"
                        stroke={color}
                        strokeWidth={2}
                        style={{ cursor: 'crosshair' }}
                        onPointerDown={(e) => { e.stopPropagation(); startWire(e, stage.id); }}
                      />
                    </g>
                  );
                })}
              </g>

              {/* Pan target rect */}
              <rect className="pan-target" x={0} y={0} width="100%" height="100%" fill="transparent" style={{ zIndex: -1 }} />
            </svg>

            {/* Empty state hint */}
            {stages.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="text-center space-y-2">
                  <div className="text-white/40 text-5xl">🗺️</div>
                  <p className="text-white/40 text-sm font-medium">Click <strong className="text-white/60">Add Stage</strong> to begin building the journey</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Background panel (overlay) ── */}
          <AnimatePresence>
            {bgPanel && (
              <motion.div
                initial={{ x: 320 }}
                animate={{ x: 0 }}
                exit={{ x: 320 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="absolute right-0 top-0 bottom-0 w-72 bg-[#1D1922] border-l border-white/10 z-10 overflow-y-auto"
              >
                <BackgroundPanel
                  settings={settings}
                  onChange={(patch) => commit({ settings: { ...settings, ...patch } })}
                  onUpload={handleBgUpload}
                  uploading={uploadingBg}
                  presets={GRADIENT_PRESETS}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Versions panel (overlay) ── */}
          <AnimatePresence>
            {showVersions && (
              <motion.div
                initial={{ x: 320 }}
                animate={{ x: 0 }}
                exit={{ x: 320 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="absolute right-0 top-0 bottom-0 w-72 bg-[#1D1922] border-l border-white/10 z-10 overflow-y-auto"
              >
                <VersionsPanel
                  versions={versions}
                  onRestore={restoreVersion}
                  onClose={() => setShowVersions(false)}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Right side panel: Stage or Edge editor ── */}
          <AnimatePresence>
            {(selectedStage || selectedEdge) && !bgPanel && !showVersions && (
              <motion.div
                initial={{ x: 340 }}
                animate={{ x: 0 }}
                exit={{ x: 340 }}
                transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                className="absolute right-0 top-0 bottom-0 w-80 bg-[#1D1922] border-l border-white/10 z-10 overflow-y-auto"
              >
                {selectedStage && (
                  <StagePanel
                    stage={selectedStage}
                    onChange={(patch) => updateStage(selectedStage.id, patch)}
                    onDuplicate={() => duplicateStage(selectedStage.id)}
                    onDelete={() => deleteStage(selectedStage.id)}
                    onClose={() => setSelectedStageId(null)}
                    colorOptions={COLOR_OPTIONS}
                    iconOptions={ICON_OPTIONS}
                  />
                )}
                {selectedEdge && (
                  <EdgePanel
                    edge={selectedEdge}
                    stages={stages}
                    onChange={(patch) => updateEdge(selectedEdge.id, patch)}
                    onDelete={() => deleteEdge(selectedEdge.id)}
                    onClose={() => setSelectedEdgeId(null)}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </AppLayout>
  );
}

// ── Stage Panel ────────────────────────────────────────────────────────────

function StagePanel({
  stage,
  onChange,
  onDuplicate,
  onDelete,
  onClose,
  colorOptions,
  iconOptions,
}: {
  stage: EditorStage;
  onChange: (patch: Partial<EditorStage>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  colorOptions: string[];
  iconOptions: string[];
}) {
  const [topicsText, setTopicsText] = useState((stage.content?.topics ?? []).join('\n'));
  const [resourcText, setResourcText] = useState(
    (stage.content?.resources ?? []).map((r) => `${r.title}|${r.url}`).join('\n'),
  );
  const [contentOpen, setContentOpen] = useState(false);

  // Sync when stage changes (e.g. different stage selected)
  useEffect(() => {
    setTopicsText((stage.content?.topics ?? []).join('\n'));
    setResourcText((stage.content?.resources ?? []).map((r) => `${r.title}|${r.url}`).join('\n'));
  }, [stage.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const flushContent = () => {
    const topics = topicsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const resources = resourcText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [title, url] = line.split('|');
        return { title: (title ?? '').trim(), url: (url ?? '').trim() };
      })
      .filter((r) => r.title);
    onChange({ content: { ...stage.content, topics, resources } });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white">Edit Stage</span>
        <div className="flex gap-1">
          <button onClick={onDuplicate} title="Duplicate" className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10"><Copy size={14} /></button>
          <button onClick={onDelete} title="Delete" className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-900/20"><Trash2 size={14} /></button>
          <button onClick={onClose} className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Title</label>
          <input
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#6542C5]"
            value={stage.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Stage title"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Description</label>
          <textarea
            rows={3}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#6542C5] resize-none"
            value={stage.description ?? ''}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Short description"
          />
        </div>

        {/* Icon */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Icon</label>
          <div className="flex flex-wrap gap-2">
            {iconOptions.map((ic) => (
              <button
                key={ic}
                onClick={() => onChange({ icon: ic })}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-lg transition-all ${
                  stage.icon === ic ? 'ring-2 ring-[#6542C5] bg-[#6542C5]/20' : 'hover:bg-white/10'
                }`}
              >
                {ic}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Color</label>
          <div className="flex flex-wrap gap-2">
            {colorOptions.map((c) => (
              <button
                key={c}
                onClick={() => onChange({ color: c })}
                style={{ background: c }}
                className={`w-7 h-7 rounded-full transition-all ${
                  stage.color === c ? 'ring-2 ring-offset-2 ring-offset-[#1D1922] ring-white scale-110' : 'hover:scale-110'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Estimated time */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Estimated time (min)</label>
          <input
            type="number"
            min={0}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6542C5]"
            value={stage.estimatedTime ?? ''}
            onChange={(e) => onChange({ estimatedTime: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="e.g. 30"
          />
        </div>

        {/* Status type */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-1">Status type</label>
          <select
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#6542C5]"
            value={stage.statusType ?? 'standard'}
            onChange={(e) => onChange({ statusType: e.target.value })}
          >
            <option value="standard">Standard</option>
            <option value="checkpoint">Checkpoint</option>
            <option value="boss">Boss Stage</option>
            <option value="optional">Optional</option>
          </select>
        </div>

        {/* Content (collapsible) */}
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <button
            onClick={() => setContentOpen((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-xs font-semibold text-white/70 hover:text-white hover:bg-white/5 transition-colors"
          >
            <span className="flex items-center gap-2"><Clock size={12} /> Content & Resources</span>
            {contentOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {contentOpen && (
            <div className="px-3 pb-3 space-y-3 border-t border-white/10">
              <div className="pt-2">
                <label className="block text-xs text-white/50 mb-1">Topics (one per line)</label>
                <textarea
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/90 resize-none focus:outline-none focus:ring-1 focus:ring-[#6542C5]"
                  value={topicsText}
                  onChange={(e) => setTopicsText(e.target.value)}
                  onBlur={flushContent}
                  placeholder="Array basics&#10;Two-pointer technique&#10;…"
                />
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1">Resources (Title|URL per line)</label>
                <textarea
                  rows={3}
                  className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/90 resize-none focus:outline-none focus:ring-1 focus:ring-[#6542C5]"
                  value={resourcText}
                  onChange={(e) => setResourcText(e.target.value)}
                  onBlur={flushContent}
                  placeholder="MDN Arrays|https://developer.mozilla.org&#10;…"
                />
              </div>
            </div>
          )}
        </div>

        {/* Position (read-only display) */}
        <div className="text-xs text-white/30 font-mono">
          x: {Math.round(stage.x ?? 0)}  y: {Math.round(stage.y ?? 0)}
        </div>
      </div>
    </div>
  );
}

// ── Edge Panel ─────────────────────────────────────────────────────────────

function EdgePanel({
  edge,
  stages,
  onChange,
  onDelete,
  onClose,
}: {
  edge: EditorEdge;
  stages: EditorStage[];
  onChange: (patch: Partial<EditorEdge>) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const from = stages.find((s) => s.id === edge.fromStageId);
  const to = stages.find((s) => s.id === edge.toStageId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white">Edit Connection</span>
        <div className="flex gap-1">
          <button onClick={onDelete} title="Delete edge" className="p-1.5 rounded text-red-400 hover:text-red-300 hover:bg-red-900/20"><Trash2 size={14} /></button>
          <button onClick={onClose} className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10"><X size={14} /></button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <p className="text-xs text-white/50">
          {from?.title ?? '?'} <span className="text-[#6542C5]">→</span> {to?.title ?? '?'}
        </p>

        {/* Style */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Line style</label>
          <div className="flex gap-2">
            {(['curve', 'straight', 'dashed'] as const).map((s) => (
              <button
                key={s}
                onClick={() => onChange({ style: s })}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  edge.style === s ? 'bg-[#6542C5] text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Color</label>
          <input
            type="color"
            value={edge.color ?? '#6542C5'}
            onChange={(e) => onChange({ color: e.target.value })}
            className="w-full h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer"
          />
        </div>

        {/* Animated */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-white/60 flex-1">Animated dot</span>
          <button
            onClick={() => onChange({ animated: !edge.animated })}
            className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${edge.animated ? 'bg-[#6542C5]' : 'bg-white/20'}`}
          >
            <span className={`inline-block h-4 w-4 rounded-full bg-white shadow mt-0.5 transition-transform ${edge.animated ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Background Panel ───────────────────────────────────────────────────────

function BackgroundPanel({
  settings,
  onChange,
  onUpload,
  uploading,
  presets,
}: {
  settings: JourneySettings;
  onChange: (patch: Partial<JourneySettings>) => void;
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  presets: { label: string; from: string; to: string }[];
}) {
  // Local ref owned by this component (avoids ref-typing issues)
  const localFileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white">Background</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">

        {/* Type tabs */}
        <div className="flex rounded-xl border border-white/10 overflow-hidden">
          {(['gradient', 'preset', 'uploaded'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onChange({ backgroundType: t })}
              className={`flex-1 py-1.5 text-xs font-medium transition-colors capitalize ${
                settings.backgroundType === t ? 'bg-[#6542C5] text-white' : 'text-white/50 hover:text-white hover:bg-white/5'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Gradient */}
        {settings.backgroundType === 'gradient' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-white/50 mb-1">From</label>
                <input type="color" value={settings.gradient?.from ?? '#1a1a2e'}
                  onChange={(e) => onChange({ gradient: { ...(settings.gradient ?? { from: '#1a1a2e', to: '#16213e', angle: 135 }), from: e.target.value } })}
                  className="w-full h-9 rounded border border-white/10 bg-transparent cursor-pointer"
                />
              </div>
              <div className="flex-1">
                <label className="block text-xs text-white/50 mb-1">To</label>
                <input type="color" value={settings.gradient?.to ?? '#16213e'}
                  onChange={(e) => onChange({ gradient: { ...(settings.gradient ?? { from: '#1a1a2e', to: '#16213e', angle: 135 }), to: e.target.value } })}
                  className="w-full h-9 rounded border border-white/10 bg-transparent cursor-pointer"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1">Angle: {settings.gradient?.angle ?? 135}°</label>
              <input type="range" min={0} max={360}
                value={settings.gradient?.angle ?? 135}
                onChange={(e) => onChange({ gradient: { ...(settings.gradient ?? { from: '#1a1a2e', to: '#16213e', angle: 135 }), angle: Number(e.target.value) } })}
                className="w-full accent-[#6542C5]"
              />
            </div>
          </div>
        )}

        {/* Presets */}
        {settings.backgroundType === 'preset' && (
          <div className="grid grid-cols-2 gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => onChange({ preset: p.label })}
                className={`rounded-xl h-16 flex items-end p-2 text-xs font-semibold text-white transition-all ${
                  settings.preset === p.label ? 'ring-2 ring-white scale-105' : 'hover:scale-105'
                }`}
                style={{ background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}

        {/* Upload */}
        {settings.backgroundType === 'uploaded' && (
          <div className="space-y-3">
            {settings.uploadedImageUrl && (
              <div className="rounded-xl overflow-hidden h-24 bg-black">
                <img src={`http://localhost:3001/api${settings.uploadedImageUrl}`} className="w-full h-full object-cover" alt="Background" />
              </div>
            )}
            <input
              ref={localFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }}
            />
            <button
              onClick={() => localFileRef.current?.click()}
              disabled={uploading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 border-dashed border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-colors text-xs font-medium disabled:opacity-50"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
              {uploading ? 'Uploading…' : 'Choose image (≤ 2 MB)'}
            </button>
          </div>
        )}

        {/* Overlay opacity */}
        <div>
          <label className="block text-xs text-white/50 mb-1">
            Overlay opacity: {Math.round((settings.overlayOpacity ?? 0.3) * 100)}%
          </label>
          <input
            type="range" min={0} max={100}
            value={Math.round((settings.overlayOpacity ?? 0.3) * 100)}
            onChange={(e) => onChange({ overlayOpacity: Number(e.target.value) / 100 })}
            className="w-full accent-[#6542C5]"
          />
        </div>

        {/* Theme colors */}
        <div>
          <label className="block text-xs font-medium text-white/60 mb-2">Theme colors</label>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-white/40 mb-1">Primary</label>
              <input type="color" value={settings.themeColors?.primary ?? '#6542C5'}
                onChange={(e) => onChange({ themeColors: { ...(settings.themeColors ?? { primary: '#6542C5', accent: '#E91E8C' }), primary: e.target.value } })}
                className="w-full h-8 rounded border border-white/10 bg-transparent cursor-pointer"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs text-white/40 mb-1">Accent</label>
              <input type="color" value={settings.themeColors?.accent ?? '#E91E8C'}
                onChange={(e) => onChange({ themeColors: { ...(settings.themeColors ?? { primary: '#6542C5', accent: '#E91E8C' }), accent: e.target.value } })}
                className="w-full h-8 rounded border border-white/10 bg-transparent cursor-pointer"
              />
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <label className="block text-xs text-white/50 mb-2">Preview</label>
          <div className="rounded-xl h-20 relative overflow-hidden">
            <div className="absolute inset-0" style={bgCss(settings)} />
            <div className="absolute inset-0 bg-black" style={{ opacity: settings.overlayOpacity ?? 0.3 }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: settings.themeColors?.primary ?? '#6542C5' }}>
                Stage node
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Versions Panel ─────────────────────────────────────────────────────────

function VersionsPanel({
  versions,
  onRestore,
  onClose,
}: {
  versions: { id: string; description: string; savedBy: string; savedAt: string }[];
  onRestore: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white">Version History</span>
        <button onClick={onClose} className="p-1.5 rounded text-white/50 hover:text-white hover:bg-white/10"><X size={14} /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {versions.length === 0 && (
          <p className="text-xs text-white/40 text-center py-8">No saved versions yet.</p>
        )}
        {versions.map((v) => (
          <div key={v.id} className="bg-white/5 rounded-xl p-3 space-y-1.5">
            <p className="text-xs font-medium text-white/80">{v.description || 'Manual save'}</p>
            <p className="text-xs text-white/40">
              {new Date(v.savedAt).toLocaleString()} · {v.savedBy}
            </p>
            <button
              onClick={() => onRestore(v.id)}
              className="flex items-center gap-1.5 text-xs font-semibold text-[#6542C5] hover:text-[#B59AF7] transition-colors"
            >
              <RotateCcw size={11} /> Restore this version
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

