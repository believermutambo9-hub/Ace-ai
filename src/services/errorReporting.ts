import {
  collection,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase.ts';

export type ErrorReportMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'UI' | 'OTHER';
export type ErrorReportEnvironment = 'browser' | 'server';
export type ErrorReportStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export const ERROR_REPORT_LIMITS = {
  ID_MAX_LEN: 64,
  USER_ID_MAX_LEN: 128,
  SOURCE_MAX_LEN: 128,
  ENDPOINT_MAX_LEN: 512,
  ERROR_MSG_MAX_LEN: 1000,
  STACK_MAX_LEN: 2000,
  CONTEXT_MAX_LEN: 1000,
  TIMESTAMP_MAX_LEN: 64,
  PENDING_QUEUE_MAX: 20,
  MEMORY_BUFFER_MAX: 50,
  DEDUP_WINDOW_MS: 10_000,
} as const;

export interface ErrorReportRecord {
  id: string;
  userId: string;
  source: string;
  endpoint: string;
  method: ErrorReportMethod;
  statusCode: number;
  errorMessage: string;
  stack?: string;
  context?: string;
  environment: ErrorReportEnvironment;
  status: ErrorReportStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface PendingErrorReportDraft {
  id: string;
  source: string;
  endpoint: string;
  method: ErrorReportMethod;
  statusCode: number;
  errorMessage: string;
  stack?: string;
  context?: string;
  environment: ErrorReportEnvironment;
  createdAt: string;
}

export interface CaptureErrorInput {
  source: string;
  endpoint: string;
  method?: string;
  statusCode?: number;
  error: unknown;
  context?: string;
}

export interface ApiFetchOptions<T = unknown> {
  source: string;
  context?: string;
  expectedStatuses?: number[];
  throwOnHttpError?: boolean;
  fallbackValue?: T;
}

export class ApiRequestError extends Error {
  public readonly statusCode: number;
  public readonly endpoint: string;
  public readonly source: string;
  public readonly reported: boolean;

  constructor(message: string, statusCode: number, endpoint: string, source: string, reported = true) {
    super(message);
    this.name = 'ApiRequestError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.source = source;
    this.reported = reported;
  }
}

const PENDING_STORAGE_KEY = 'pitchintel_pending_error_reports_v1';
const ADMIN_EMAIL = 'believermutambo9@gmail.com';
const VALID_METHODS = new Set<ErrorReportMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'UI', 'OTHER']);

function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

export function normalizeMethod(method?: string): ErrorReportMethod {
  const upper = (method || 'GET').toUpperCase().trim() as ErrorReportMethod;
  return VALID_METHODS.has(upper) ? upper : 'OTHER';
}

export function sanitizeEndpoint(rawEndpoint: string): string {
  const trimmed = (rawEndpoint || 'unknown').trim();
  if (!trimmed) return 'unknown';

  try {
    const base = isBrowserEnv() ? window.location.origin : 'http://localhost';
    const parsed = new URL(trimmed, base);
    const sensitiveParams = ['apikey', 'api_key', 'token', 'secret', 'key', 'auth', 'password', 'signature'];
    for (const param of Array.from(parsed.searchParams.keys())) {
      if (sensitiveParams.some((s) => param.toLowerCase().includes(s))) {
        parsed.searchParams.set(param, 'REDACTED');
      }
    }
    const clean = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? `${parsed.origin}${parsed.pathname}${parsed.search}`
      : `${parsed.pathname}${parsed.search}`;
    return clean.slice(0, ERROR_REPORT_LIMITS.ENDPOINT_MAX_LEN) || 'unknown';
  } catch {
    return trimmed
      .replace(/([?&](?:api_?key|token|secret|auth|password)=)[^&]+/gi, '$1REDACTED')
      .slice(0, ERROR_REPORT_LIMITS.ENDPOINT_MAX_LEN) || 'unknown';
  }
}

export function sanitizeErrorText(raw: string, maxLen: number): string {
  return (raw || '')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:api_?key|token|secret|auth|password)=)[^&\s]+/gi, '$1[REDACTED]')
    .trim()
    .slice(0, maxLen);
}

export function extractErrorMessage(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: sanitizeErrorText(error.message || error.name || 'Unhandled error', ERROR_REPORT_LIMITS.ERROR_MSG_MAX_LEN) || 'Unhandled error',
      stack: error.stack ? sanitizeErrorText(error.stack, ERROR_REPORT_LIMITS.STACK_MAX_LEN) : undefined,
    };
  }
  if (typeof error === 'string') {
    return {
      message: sanitizeErrorText(error, ERROR_REPORT_LIMITS.ERROR_MSG_MAX_LEN) || 'Unhandled error',
    };
  }
  try {
    return {
      message: sanitizeErrorText(JSON.stringify(error), ERROR_REPORT_LIMITS.ERROR_MSG_MAX_LEN) || 'Unhandled error',
    };
  } catch {
    return { message: 'Unhandled non-serializable error' };
  }
}

export function generateReportId(): string {
  const rand = Math.random().toString(36).replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || '0000';
  return `err_${Date.now()}_${rand}`.slice(0, ERROR_REPORT_LIMITS.ID_MAX_LEN);
}

export function buildFirestoreErrorReportDoc(
  draft: PendingErrorReportDraft,
  userId: string
): ErrorReportRecord {
  const docPayload: ErrorReportRecord = {
    id: draft.id.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, ERROR_REPORT_LIMITS.ID_MAX_LEN),
    userId: userId.slice(0, ERROR_REPORT_LIMITS.USER_ID_MAX_LEN),
    source: (draft.source || 'data-layer').slice(0, ERROR_REPORT_LIMITS.SOURCE_MAX_LEN),
    endpoint: sanitizeEndpoint(draft.endpoint),
    method: normalizeMethod(draft.method),
    statusCode: Math.min(599, Math.max(0, Math.round(Number(draft.statusCode) || 0))),
    errorMessage: (sanitizeErrorText(draft.errorMessage, ERROR_REPORT_LIMITS.ERROR_MSG_MAX_LEN) || 'Unhandled API failure'),
    environment: draft.environment,
    status: 'OPEN',
    createdAt: draft.createdAt.slice(0, ERROR_REPORT_LIMITS.TIMESTAMP_MAX_LEN),
  };

  if (draft.stack && draft.stack.trim().length > 0) {
    docPayload.stack = sanitizeErrorText(draft.stack, ERROR_REPORT_LIMITS.STACK_MAX_LEN);
  }
  if (draft.context && draft.context.trim().length > 0) {
    docPayload.context = sanitizeErrorText(draft.context, ERROR_REPORT_LIMITS.CONTEXT_MAX_LEN);
  }

  return docPayload;
}

function shouldSkipTelemetryTarget(endpoint: string, message: string): boolean {
  const lowerEp = endpoint.toLowerCase();
  const lowerMsg = message.toLowerCase();
  if (
    lowerEp.includes('firestore.googleapis.com') ||
    lowerEp.includes('identitytoolkit.googleapis.com') ||
    lowerEp.includes('securetoken.googleapis.com')
  ) {
    return true;
  }
  if (lowerMsg.includes('missing or insufficient permissions') && lowerMsg.includes('error_reports')) {
    return true;
  }
  return false;
}

class ErrorReportingManager {
  private recentBuffer: PendingErrorReportDraft[] = [];
  private dedupTimestamps = new Map<string, number>();
  private isWritingToFirestore = false;
  private listenersInstalled = false;

  public getRecentErrors(): PendingErrorReportDraft[] {
    return [...this.recentBuffer];
  }

  public clearRecentErrors(): void {
    this.recentBuffer = [];
    this.dedupTimestamps.clear();
  }

  private recordInMemory(draft: PendingErrorReportDraft): void {
    this.recentBuffer.unshift(draft);
    if (this.recentBuffer.length > ERROR_REPORT_LIMITS.MEMORY_BUFFER_MAX) {
      this.recentBuffer.length = ERROR_REPORT_LIMITS.MEMORY_BUFFER_MAX;
    }
  }

  private loadPendingQueue(): PendingErrorReportDraft[] {
    if (!isBrowserEnv()) return [];
    try {
      const raw = localStorage.getItem(PENDING_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private savePendingQueue(queue: PendingErrorReportDraft[]): void {
    if (!isBrowserEnv()) return;
    try {
      const bounded = queue.slice(0, ERROR_REPORT_LIMITS.PENDING_QUEUE_MAX);
      localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(bounded));
    } catch {
      // Ignore storage quota errors cleanly
    }
  }

  private enqueuePending(draft: PendingErrorReportDraft): void {
    const queue = this.loadPendingQueue();
    queue.unshift(draft);
    this.savePendingQueue(queue);
  }

  private async persistDraftToFirestore(draft: PendingErrorReportDraft): Promise<boolean> {
    const user = auth.currentUser;
    if (!user || user.emailVerified === false || this.isWritingToFirestore) {
      return false;
    }

    const payload = buildFirestoreErrorReportDoc(draft, user.uid);
    const path = `error_reports/${payload.id}`;

    this.isWritingToFirestore = true;
    try {
      await setDoc(doc(db, 'error_reports', payload.id), payload);
      return true;
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.CREATE, path);
      } catch {
        // Structured Firestore error already logged by handleFirestoreError; never cascade
      }
      return false;
    } finally {
      this.isWritingToFirestore = false;
    }
  }

  /**
   * Capture and report an unhandled API or data-layer failure.
   */
  public async reportApiFailure(input: CaptureErrorInput): Promise<PendingErrorReportDraft | null> {
    const { message, stack } = extractErrorMessage(input.error);
    const endpoint = sanitizeEndpoint(input.endpoint);

    if (shouldSkipTelemetryTarget(endpoint, message)) {
      return null;
    }

    const source = (input.source || 'data-layer').slice(0, ERROR_REPORT_LIMITS.SOURCE_MAX_LEN) || 'data-layer';
    const method = normalizeMethod(input.method);
    const statusCode = Math.min(599, Math.max(0, Math.round(Number(input.statusCode) || 0)));

    // Deduplicate identical failures inside short window to prevent polling log storms
    const dedupKey = `${source}|${method}|${endpoint}|${statusCode}|${message.slice(0, 120)}`;
    const now = Date.now();
    const lastSeen = this.dedupTimestamps.get(dedupKey);
    if (lastSeen && now - lastSeen < ERROR_REPORT_LIMITS.DEDUP_WINDOW_MS) {
      return null;
    }
    this.dedupTimestamps.set(dedupKey, now);

    const draft: PendingErrorReportDraft = {
      id: generateReportId(),
      source,
      endpoint,
      method,
      statusCode,
      errorMessage: message,
      ...(stack ? { stack } : {}),
      ...(input.context ? { context: sanitizeErrorText(input.context, ERROR_REPORT_LIMITS.CONTEXT_MAX_LEN) } : {}),
      environment: isBrowserEnv() ? 'browser' : 'server',
      createdAt: new Date(now).toISOString(),
    };

    this.recordInMemory(draft);

    console.error(
      `[ErrorReporting][${draft.environment}] ${draft.source} ${draft.method} ${draft.endpoint} (${draft.statusCode}): ${draft.errorMessage}`
    );

    if (isBrowserEnv()) {
      const user = auth.currentUser;
      if (user && user.emailVerified !== false) {
        const persisted = await this.persistDraftToFirestore(draft);
        if (!persisted) {
          this.enqueuePending(draft);
        }
      } else {
        this.enqueuePending(draft);
      }
    }

    return draft;
  }

  /**
   * Flush any buffered browser API errors to Firestore once the user authenticates.
   */
  public async flushPendingReports(): Promise<number> {
    if (!isBrowserEnv()) return 0;
    const user = auth.currentUser;
    if (!user || user.emailVerified === false) return 0;

    const pending = this.loadPendingQueue();
    if (pending.length === 0) return 0;

    const remaining: PendingErrorReportDraft[] = [];
    let flushedCount = 0;

    for (const draft of pending) {
      const ok = await this.persistDraftToFirestore(draft);
      if (ok) {
        flushedCount++;
      } else {
        remaining.push(draft);
      }
    }

    this.savePendingQueue(remaining);
    return flushedCount;
  }

  /**
   * Centralized data-layer fetch boundary that captures network errors and unexpected HTTP failures.
   */
  public async apiFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: ApiFetchOptions
  ): Promise<Response> {
    const endpoint = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || (typeof input !== 'string' && !(input instanceof URL) ? input.method : 'GET');
    const source = options?.source || 'data-layer';

    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (err) {
      // Ignore intentional caller AbortError
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      await this.reportApiFailure({
        source,
        endpoint,
        method,
        statusCode: 0,
        error: err,
        context: options?.context,
      });
      throw err;
    }

    const expected = options?.expectedStatuses || [];
    if (!response.ok && !expected.includes(response.status)) {
      let detail = `HTTP ${response.status} ${response.statusText || ''}`.trim();
      try {
        const cloned = response.clone();
        const body = await cloned.json();
        if (body && typeof body.error === 'string' && body.error.trim()) {
          detail = `HTTP ${response.status}: ${body.error}`;
        }
      } catch {
        // Keep status text fallback
      }

      await this.reportApiFailure({
        source,
        endpoint,
        method,
        statusCode: response.status,
        error: new Error(detail),
        context: options?.context,
      });

      if (options?.throwOnHttpError) {
        throw new ApiRequestError(detail, response.status, endpoint, source, true);
      }
    }

    return response;
  }

  /**
   * Typed JSON data-layer fetch helper with centralized error boundary capture.
   */
  public async fetchJson<T>(
    input: RequestInfo | URL,
    init?: RequestInit,
    options?: ApiFetchOptions<T>
  ): Promise<T> {
    const endpoint = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method || 'GET';
    const source = options?.source || 'data-layer';

    try {
      const response = await this.apiFetch(input, init, {
        ...options,
        source,
        throwOnHttpError: options?.throwOnHttpError ?? true,
      });

      try {
        const data = await response.json();
        return data as T;
      } catch (parseErr) {
        await this.reportApiFailure({
          source,
          endpoint,
          method,
          statusCode: response.status,
          error: parseErr,
          context: options?.context || 'Invalid JSON payload returned by endpoint',
        });
        throw parseErr;
      }
    } catch (err) {
      if (options && 'fallbackValue' in options && options.fallbackValue !== undefined) {
        return options.fallbackValue;
      }
      throw err;
    }
  }

  /**
   * Generic async boundary wrapper for non-fetch data-layer operations.
   */
  public async withErrorBoundary<T>(
    source: string,
    endpoint: string,
    fn: () => Promise<T>,
    options?: { method?: ErrorReportMethod; context?: string; fallbackValue?: T }
  ): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      await this.reportApiFailure({
        source,
        endpoint,
        method: options?.method || 'OTHER',
        statusCode: 0,
        error: err,
        context: options?.context,
      });
      if (options && 'fallbackValue' in options && options.fallbackValue !== undefined) {
        return options.fallbackValue;
      }
      throw err;
    }
  }

  /**
   * Subscribe to persisted Firestore error_reports scoped strictly per security rules.
   */
  public subscribeToErrorReports(
    onReports: (reports: ErrorReportRecord[]) => void,
    maxResults = 50
  ): Unsubscribe | null {
    const user = auth.currentUser;
    if (!user) return null;

    const isAdmin =
      user.emailVerified === true &&
      (user.email || '').toLowerCase() === ADMIN_EMAIL;

    const q = isAdmin
      ? query(collection(db, 'error_reports'), orderBy('createdAt', 'desc'), limit(maxResults))
      : query(
          collection(db, 'error_reports'),
          where('userId', '==', user.uid),
          orderBy('createdAt', 'desc'),
          limit(maxResults)
        );

    return onSnapshot(
      q,
      (snapshot) => {
        const items: ErrorReportRecord[] = [];
        snapshot.forEach((d) => {
          items.push(d.data() as ErrorReportRecord);
        });
        onReports(items);
      },
      (error) => {
        try {
          handleFirestoreError(error, OperationType.LIST, 'error_reports');
        } catch {
          // Structured error already logged
        }
      }
    );
  }

  /**
   * Admin-only status update for monitoring triage.
   */
  public async updateErrorReportStatus(
    reportId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED'
  ): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    const path = `error_reports/${reportId}`;
    try {
      await updateDoc(doc(db, 'error_reports', reportId), {
        status,
        ...(status === 'RESOLVED' ? { resolvedAt: new Date().toISOString() } : {}),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  }

  /**
   * Install idempotent browser-level global error listeners to capture unhandled rejections.
   */
  public installGlobalListeners(): void {
    if (!isBrowserEnv() || this.listenersInstalled) return;
    this.listenersInstalled = true;

    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      const msg = reason instanceof Error ? reason.message : String(reason || '');
      if (msg.includes('error_reports')) return;
      this.reportApiFailure({
        source: 'window.unhandledrejection',
        endpoint: window.location.pathname || '/',
        method: 'UI',
        statusCode: 0,
        error: reason,
        context: 'Unhandled promise rejection captured globally',
      }).catch(() => {});
    });
  }
}

export const ErrorReportingService = new ErrorReportingManager();
export default ErrorReportingService;
