import { CclDataset, VersionsResponse } from './types';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || response.statusText);
  }
  return response.json() as Promise<T>;
}

export async function getVersions(): Promise<VersionsResponse> {
  const res = await fetch('/api/versions');
  return handleResponse<VersionsResponse>(res);
}

export async function getCcl(date?: string): Promise<CclDataset> {
  const url = new URL('/api/ccl', window.location.origin);
  if (date) {
    url.searchParams.set('date', date);
  }
  const res = await fetch(url);
  return handleResponse<CclDataset>(res);
}

export async function refreshCcl(date?: string): Promise<CclDataset> {
  const res = await fetch('/api/ccl/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ date, force: true }),
  });
  const payload = await handleResponse<{ message: string; data: CclDataset }>(res);
  return payload.data;
}
