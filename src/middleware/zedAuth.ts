import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export interface ZedAuthenticatedRequest extends Request {
  requestId?: string;
  clientService?: string;
}

/**
 * Timing-safe string comparison to protect against side-channel timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Secure Server-to-Server (S2S) Authentication Middleware for Zed.
 * Validates request authentication against PITCHINTEL_SERVICE_SECRET.
 * Uses timing-safe verification, attaches request correlation IDs, and sanitizes logging.
 */
export const zedAuthMiddleware = (
  req: ZedAuthenticatedRequest,
  res: Response,
  next: NextFunction
) => {
  // 1. Generate or extract distributed trace ID
  const requestId =
    (req.headers['x-request-id'] as string) ||
    `zed-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  // 2. Validate S2S authentication header
  const configuredSecret = process.env.PITCHINTEL_SERVICE_SECRET;
  const providedSecret =
    (req.headers['x-pitchintel-service-secret'] as string) ||
    (req.headers['authorization']?.startsWith('Bearer ')
      ? req.headers['authorization'].split('Bearer ')[1]
      : null);

  // If running in production, a strong secret MUST be configured
  if (process.env.NODE_ENV === 'production' && !configuredSecret) {
    console.error(`[Zed S2S] Configuration error: PITCHINTEL_SERVICE_SECRET is required in production (id=${requestId})`);
    return res.status(500).json({
      error: 'Service configuration error: PITCHINTEL_SERVICE_SECRET is required in production environment',
      requestId,
    });
  }

  const effectiveSecret = configuredSecret || 'zed-pitchintel-dev-secret-token';

  if (!providedSecret || !safeCompare(providedSecret, effectiveSecret)) {
    console.warn(`[Zed S2S] Unauthorized request attempt rejected (id=${requestId})`);
    return res.status(401).json({
      error: 'Unauthorized: Invalid or missing service secret',
      requestId,
      documentation: 'Provide x-pitchintel-service-secret header or Bearer authorization token',
    });
  }

  req.clientService = 'zed-assistant';
  next();
};
