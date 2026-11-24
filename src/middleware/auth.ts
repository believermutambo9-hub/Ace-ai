import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { adminAuth } from '../lib/firebase-admin.ts';
import { DecodedIdToken } from 'firebase-admin/auth';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  authMethod?: 'firebase_admin' | 'service_secret';
}

function safeCompareSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getAllowedAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS || 'believermutambo9@gmail.com';
  return raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
  } catch (error) {
    console.warn('Optional token verification notice:', error);
  }
  next();
};

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing Bearer token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const requireAdminOrService = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const configuredSecret =
    process.env.PITCHINTEL_SERVICE_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : 'zed-pitchintel-dev-secret-token');

  const headerSecret = req.headers['x-pitchintel-service-secret'];
  const providedSecret = typeof headerSecret === 'string' ? headerSecret : null;

  if (providedSecret && configuredSecret && safeCompareSecret(providedSecret, configuredSecret)) {
    req.authMethod = 'service_secret';
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized: Administrator sign-in or valid service credential required.',
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Empty bearer credential.' });
  }

  // Also allow Bearer service secret for automated S2S callers
  if (configuredSecret && safeCompareSecret(token, configuredSecret)) {
    req.authMethod = 'service_secret';
    return next();
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;

    const email = (decodedToken.email || '').toLowerCase();
    const isAdminClaim = decodedToken.admin === true;
    const isAllowedEmail =
      Boolean(email) &&
      decodedToken.email_verified !== false &&
      getAllowedAdminEmails().includes(email);

    if (!isAdminClaim && !isAllowedEmail) {
      return res.status(403).json({
        error: 'Forbidden: Administrator privileges are required for this operation.',
      });
    }

    req.authMethod = 'firebase_admin';
    return next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token.' });
  }
};
