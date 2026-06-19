import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../api/client';

export type Summary = {
  totalFills: number;
  successFills: number;
  partialFills: number;
  failureFills: number;
  successRate: number;
  activeUsers: number;
  vendorCount: number;
  failingScripts: number;
  avgDurationMs: number | null;
  from: string;
  to: string;
};

export type VendorStat = {
  vendorId: string;
  vendorName: string;
  vendorUrl: string;
  totalFills: number;
  successRate: number;
  latestScriptStatus: string | null;
  latestScriptVersion: number | null;
};

export type UserStat = {
  userId: string;
  email: string;
  name: string | null;
  team: string | null;
  totalFills: number;
  successRate: number;
};

export type ScriptHealth = {
  scriptId: string;
  version: number;
  status: string;
  vendor: { id: string; name: string; url: string };
  totalEvents: number;
  recentFailures: Array<{
    id: string;
    status: string;
    fieldResults: unknown;
    error: string | null;
    createdAt: string;
  }>;
};

export type Vendor = {
  id: string;
  name: string;
  url: string;
  scripts: Array<{ id: string; version: number; status: string; content: string }>;
  _count: { events: number };
};

function rangeParams(from: Date, to: Date) {
  return `from=${from.toISOString()}&to=${to.toISOString()}`;
}

export const useSummary = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['summary', from.toISOString(), to.toISOString()],
    queryFn: () => apiFetch<Summary>(`/api/analytics/summary?${rangeParams(from, to)}`),
    refetchInterval: 30_000,
  });

export const useByVendor = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['by-vendor', from.toISOString(), to.toISOString()],
    queryFn: () => apiFetch<VendorStat[]>(`/api/analytics/by-vendor?${rangeParams(from, to)}`),
  });

export const useByUser = (from: Date, to: Date) =>
  useQuery({
    queryKey: ['by-user', from.toISOString(), to.toISOString()],
    queryFn: () => apiFetch<UserStat[]>(`/api/analytics/by-user?${rangeParams(from, to)}`),
  });

export const useScriptHealth = () =>
  useQuery({
    queryKey: ['script-health'],
    queryFn: () => apiFetch<ScriptHealth[]>('/api/analytics/script-health'),
    refetchInterval: 30_000,
  });

export const useVendors = () =>
  useQuery({ queryKey: ['vendors'], queryFn: () => apiFetch<Vendor[]>('/api/vendors') });

/** Ping /health for the live connection indicator. */
export const useHealth = () =>
  useQuery({
    queryKey: ['health'],
    queryFn: async () => {
      const base = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${base}/health`);
      if (!res.ok) throw new Error('down');
      return (await res.json()) as { ok: boolean };
    },
    refetchInterval: 10_000,
    retry: false,
  });
