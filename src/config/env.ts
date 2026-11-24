import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load local environment files if present
dotenv.config();

/**
 * PitchIntel Unified Environment Configuration
 * Centralizes, normalizes, and validates all environment variables for PitchIntel.
 */
export interface EnvironmentConfig {
  nodeEnv: string;
  port: number;
  appUrl: string;
  database: {
    url?: string;
    host?: string;
    user?: string;
    password?: string;
    databaseName?: string;
    isConfigured: boolean;
    provider: 'CLOUD_SQL_POSTGRES' | 'DATABASE_URL_POSTGRES' | 'NOT_CONFIGURED';
  };
  providers: {
    footballDataApiKey?: string;
    apiFootballKey?: string;
    rapidApiKey?: string;
    hasActiveProvider: boolean;
  };
  zedIntegration: {
    serviceSecret: string;
    apiUrl: string;
  };
  firebase: {
    projectId?: string;
    hasConfig: boolean;
  };
}

export function initializeEnvironment(): EnvironmentConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = Number(process.env.PORT) || 3000;

  // 1. Resolve Canonical App URL (APP_URL or fallback)
  const appUrl = (process.env.APP_URL || `http://localhost:${port}`).replace(/\/$/, '');
  process.env.APP_URL = appUrl;

  // If Cloud SQL discrete parameters are present but DATABASE_URL is not, synthesize it safely
  if (!process.env.DATABASE_URL && process.env.SQL_HOST) {
    const user = process.env.SQL_USER || 'postgres';
    const pass = process.env.SQL_PASSWORD || '';
    const host = process.env.SQL_HOST;
    const dbName = process.env.SQL_DB_NAME || 'postgres';
    if (host.startsWith('/')) {
      process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@/${dbName}?host=${encodeURIComponent(host)}`;
    } else {
      process.env.DATABASE_URL = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/${dbName}`;
    }
  }

  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
  const hasSqlParams = Boolean(process.env.SQL_HOST && process.env.SQL_USER);
  const isDbConfigured = hasDatabaseUrl || hasSqlParams;

  const dbProvider: 'CLOUD_SQL_POSTGRES' | 'DATABASE_URL_POSTGRES' | 'NOT_CONFIGURED' =
    hasDatabaseUrl
      ? 'DATABASE_URL_POSTGRES'
      : hasSqlParams
      ? 'CLOUD_SQL_POSTGRES'
      : 'NOT_CONFIGURED';

  // 3. Resolve Football Providers
  const footballDataApiKey = process.env.FOOTBALL_DATA_API_KEY || undefined;
  const apiFootballKey = process.env.API_FOOTBALL_KEY || process.env.RAPIDAPI_KEY || undefined;
  const rapidApiKey = process.env.RAPIDAPI_KEY || undefined;
  const hasActiveProvider = Boolean(footballDataApiKey || apiFootballKey);

  // 4. Resolve Zed Assistant Integration
  // Use configured secret, or safe fallback token for local development
  const serviceSecret =
    process.env.PITCHINTEL_SERVICE_SECRET ||
    (nodeEnv === 'production' ? '' : 'zed-pitchintel-dev-secret-token');

  if (!process.env.PITCHINTEL_SERVICE_SECRET && nodeEnv !== 'production') {
    process.env.PITCHINTEL_SERVICE_SECRET = serviceSecret;
  }

  // Canonical S2S base URL
  const zedApiUrl = process.env.PITCHINTEL_API_URL || appUrl;
  process.env.PITCHINTEL_API_URL = zedApiUrl;

  // 5. Firebase Check
  let hasFirebase = false;
  let firebaseProjectId: string | undefined;
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
      firebaseProjectId = parsed.projectId;
      hasFirebase = Boolean(firebaseProjectId);
    }
  } catch {
    // Ignore if not present
  }

  return {
    nodeEnv,
    port,
    appUrl,
    database: {
      url: process.env.DATABASE_URL,
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      databaseName: process.env.SQL_DB_NAME,
      isConfigured: isDbConfigured,
      provider: dbProvider,
    },
    providers: {
      footballDataApiKey,
      apiFootballKey,
      rapidApiKey,
      hasActiveProvider,
    },
    zedIntegration: {
      serviceSecret,
      apiUrl: zedApiUrl,
    },
    firebase: {
      projectId: firebaseProjectId,
      hasConfig: hasFirebase,
    },
  };
}

export const envConfig = initializeEnvironment();
