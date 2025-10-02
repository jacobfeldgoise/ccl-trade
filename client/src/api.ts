import {
  CclDataset,
  FederalRegisterDocumentsResponse,
  FederalRegisterRefreshEvent,
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

export async function refreshFederalRegisterDocuments(
  onEvent?: (event: FederalRegisterRefreshEvent) => void
): Promise<FederalRegisterRefreshResponse> {
  const res = await fetch('/api/federal-register/refresh', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }

  if (!res.body) {
    throw new Error('No response body received from refresh request.');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: FederalRegisterRefreshResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      let event: FederalRegisterRefreshEvent | null = null;
      try {
        event = JSON.parse(line) as FederalRegisterRefreshEvent;
      } catch (parseError) {
        console.warn('Unable to parse refresh progress event', parseError);
        continue;
      }

      onEvent?.(event);

      if (event.type === 'complete') {
        finalResult = event.result ?? null;
      } else if (event.type === 'error') {
        throw new Error(event.message || 'Refresh failed.');
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as FederalRegisterRefreshEvent;
      onEvent?.(event);
      if (event.type === 'complete') {
        finalResult = event.result ?? null;
      } else if (event.type === 'error') {
        throw new Error(event.message || 'Refresh failed.');
      }
    } catch (parseError) {
      console.warn('Unable to parse trailing refresh progress event', parseError);
    }
  }

  if (!finalResult) {
    throw new Error('Refresh did not complete successfully.');
  }

  return finalResult;
}

