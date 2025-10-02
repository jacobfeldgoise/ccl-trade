import {
  CclDataset,
  FederalRegisterDocumentsResponse,
  FederalRegisterRefreshResponse,
  VersionsResponse,
} from './types';

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

export async function downloadCcl(date: string): Promise<CclDataset> {
  const res = await fetch('/api/ccl/download', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ date }),
  });
  const payload = await handleResponse<{
    message: string;
    data: CclDataset;
    rawDownloadedAt: string | null;
    reDownloadedRaw: boolean;
  }>(res);
  return payload.data;
}

export async function reparseStoredCcls(): Promise<{
  message: string;
  processedDates: { date: string; fetchedAt: string }[];
}> {
  const res = await fetch('/api/ccl/reparse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return handleResponse<{ message: string; processedDates: { date: string; fetchedAt: string }[] }>(res);
}

export async function getFederalRegisterDocuments(): Promise<FederalRegisterDocumentsResponse> {
  const res = await fetch('/api/federal-register/documents');
  return handleResponse<FederalRegisterDocumentsResponse>(res);
}

export async function refreshFederalRegisterDocuments(): Promise<FederalRegisterRefreshResponse> {
  const res = await fetch('/api/federal-register/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  return handleResponse<FederalRegisterRefreshResponse>(res);
}

