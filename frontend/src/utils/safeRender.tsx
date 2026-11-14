import React from 'react';

export function safeRenderText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.name && typeof obj.name === 'string') return obj.name;
    if (obj.title && typeof obj.title === 'string') return obj.title;
    if (obj.topic && typeof obj.topic === 'string') return obj.topic;
    if (obj.point && typeof obj.point === 'string') return obj.point;
    if (obj.area && typeof obj.area === 'string') return obj.area;
    if (obj.text && typeof obj.text === 'string') return obj.text;
    try {
      return JSON.stringify(value);
    } catch {
      return '[Object]';
    }
  }

  return String(value);
}

export function SafeText({ value, fallback = '' }: { value: unknown; fallback?: string }) {
  const rendered = safeRenderText(value);
  return <>{rendered || fallback}</>;
}
