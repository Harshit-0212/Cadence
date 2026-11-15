/**
 * journeyAdminService.ts
 * Admin-only API calls for the Journey Editor.
 * All endpoints sit under /api/admin/journey/* which the server
 * protects with requireAdmin (403 for non-admins).
 */
import { API_URL } from './api';

const BASE = '/admin/journey';

async function adminFetch<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem('nova_auth_token');
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  // Don't set Content-Type for FormData (browser sets multipart boundary)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw Object.assign(new Error(json.error?.message || 'Admin API Error'), {
      status: res.status,
    });
  }
  return json.data as T;
}

// ── Types (mirrors backend public shapes) ──────────────────────────────────

export interface EditorStage {
  id: string;
  journeyId: string;
  title: string;
  slug: string;
  description?: string;
  icon?: string;
  color?: string;
  x?: number;
  y?: number;
  order?: number;
  statusType?: string;
  estimatedTime?: number;
  content?: {
    topics?: string[];
    resources?: Array<{ title: string; url: string }>;
    linkedQuizIds?: string[];
    linkedCodingIds?: string[];
    linkedPlannerIds?: string[];
  };
}

export interface EditorEdge {
  id: string;
  fromStageId: string;
  toStageId: string;
  style?: 'curve' | 'straight' | 'dashed';
  color?: string;
  animated?: boolean;
}

export interface JourneySettings {
  backgroundType: 'gradient' | 'preset' | 'uploaded';
  gradient?: { from: string; to: string; angle: number };
  preset?: string;
  uploadedImageId?: string;
  uploadedImageUrl?: string;
  themeColors?: { primary: string; accent: string };
  overlayOpacity?: number;
}

export interface JourneyGraph {
  stages: EditorStage[];
  edges: EditorEdge[];
  settings: JourneySettings;
}

export interface JourneyVersion {
  id: string;
  description: string;
  savedBy: string;
  savedAt: string;
}

// ── Service ────────────────────────────────────────────────────────────────

export const journeyAdminService = {
  // Graph (stages + edges + settings together)
  async getJourneyGraph(journeyId: string): Promise<JourneyGraph> {
    return adminFetch<JourneyGraph>(`${BASE}/journeys/${journeyId}/graph`);
  },

  async saveJourneyGraph(
    journeyId: string,
    payload: { stages: EditorStage[]; edges: EditorEdge[]; settings: JourneySettings; description?: string },
  ): Promise<JourneyGraph> {
    return adminFetch<JourneyGraph>(`${BASE}/journeys/${journeyId}/graph`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // Settings only
  async getJourneySettings(journeyId: string): Promise<JourneySettings> {
    return adminFetch<JourneySettings>(`${BASE}/journeys/${journeyId}/settings`);
  },

  async saveJourneySettings(journeyId: string, settings: Partial<JourneySettings>): Promise<JourneySettings> {
    return adminFetch<JourneySettings>(`${BASE}/journeys/${journeyId}/settings`, {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  },

  // Background image upload
  async uploadBackgroundImage(
    journeyId: string,
    file: File,
  ): Promise<{ fileId: string; imageUrl: string; settings: JourneySettings }> {
    const form = new FormData();
    form.append('image', file);
    return adminFetch(`${BASE}/journeys/${journeyId}/background-image`, {
      method: 'POST',
      body: form,
    });
  },

  // Versions / restore
  async listVersions(journeyId: string): Promise<JourneyVersion[]> {
    return adminFetch<JourneyVersion[]>(`${BASE}/journeys/${journeyId}/versions`);
  },

  async restoreVersion(journeyId: string, versionId: string): Promise<JourneyGraph> {
    return adminFetch<JourneyGraph>(`${BASE}/journeys/${journeyId}/versions/${versionId}/restore`, {
      method: 'POST',
    });
  },

  // Stage deletion
  async deleteStage(stageId: string): Promise<void> {
    await adminFetch<void>(`${BASE}/stages/${stageId}`, { method: 'DELETE' });
  },
};
