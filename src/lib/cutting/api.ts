"use client";

import { auth } from "@/lib/firebaseClient";

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(url, {
    ...init,
    headers: { ...headers, ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const cuttingApi = {
  listJobs: () => request<{ ok: true; jobs: any[] }>("/api/cutting/jobs"),
  getJob: (id: string) => request<{ ok: true; job: any }>(`/api/cutting/jobs/${id}`),
  createJob: (body: Record<string, unknown>) =>
    request<{ ok: true; job: any }>("/api/cutting/jobs", { method: "POST", body: JSON.stringify(body) }),
  updateJob: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true; job: any }>(`/api/cutting/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  completeJob: (id: string) =>
    request<{ ok: true }>(`/api/cutting/jobs/${id}/complete`, { method: "POST" }),
  generatePlt: (
    id: string,
    body: { svg: string; materialProfileId?: string; mediaWidthMm?: number },
  ) =>
    request<{
      ok: true;
      hpgl: string;
      pathCount: number;
      totalLengthMm: number;
      boundingBoxMm: { width: number; height: number };
      profileUsed: string;
      filename: string;
    }>(`/api/cutting/jobs/${id}/plt`, { method: "POST", body: JSON.stringify(body) }),
  listProfiles: () =>
    request<{ ok: true; profiles: any[] }>("/api/cutting/material-profiles"),
  createProfile: (body: Record<string, unknown>) =>
    request<{ ok: true; profile: any }>("/api/cutting/material-profiles", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateProfile: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/cutting/material-profiles/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
};
