export interface IntranetAppConfig {
  port: number;
  nodeEnv: string;
  swaggerEnabled: boolean;
  publicBasePath: string;
  database: {
    url?: string;
    host: string;
    port: number;
    name: string;
    user: string;
    pass: string;
    synchronize: boolean;
    autoCreate: boolean;
    migrationsRun: boolean;
    ssl: boolean;
  };
  jwt: {
    secret: string;
  };
  internalServiceSecret: string;
  externalApiKeys: Map<string, string>;
  mainBackendUrl: string;
  mainUrl: string;
  notificationServiceUrl: string;
  webhookUrl: string;
  webhookSecret: string;
  lostFoundArchiveDays: number;
  imagekit: {
    publicKey: string;
    privateKey: string;
    urlEndpoint: string;
  };
}

/**
 * Parses `EXTERNAL_API_KEYS` from either JSON (`{"key":"tenant"}`) or `key:tenant,key2:tenant2`.
 */
export function parseExternalApiKeys(raw?: string): Map<string, string> {
  const result = new Map<string, string>();
  const trimmed = String(raw || '').trim();
  if (!trimmed) return result;

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, string>;
      for (const [apiKey, tenant] of Object.entries(parsed)) {
        const cleanKey = apiKey.trim();
        const cleanTenant = String(tenant || '').trim().toLowerCase();
        if (cleanKey && cleanTenant) {
          result.set(cleanKey, cleanTenant);
        }
      }
      return result;
    } catch {
      // Fall through to comma-separated format if JSON is malformed
    }
  }

  for (const entry of trimmed.split(',')) {
    const [rawKey, rawTenant] = entry.split(':').map((part) => part.trim());
    if (rawKey && rawTenant) {
      result.set(rawKey, rawTenant.toLowerCase());
    }
  }
  return result;
}

export const intranetConfiguration = (): IntranetAppConfig => {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const defaultArchiveDays = Number(process.env.LOST_FOUND_ARCHIVE_DAYS || '45');
  const dbUrl = process.env.DATABASE_URL?.trim() || undefined;
  const swaggerEnabled =
    process.env.SWAGGER_ENABLED !== undefined
      ? process.env.SWAGGER_ENABLED.toLowerCase() !== 'false'
      : nodeEnv !== 'production';
  const ssl =
    process.env.DB_SSL !== undefined
      ? process.env.DB_SSL === 'true'
      : Boolean(dbUrl && /sslmode=(require|verify-full|verify-ca)/i.test(dbUrl));

  return {
    port: parseInt(process.env.PORT || '3004', 10) || 3004,
    nodeEnv,
    swaggerEnabled,
    publicBasePath: (process.env.PUBLIC_BASE_PATH || '')
      .trim()
      .replace(/\/+$/, ''),
    database: {
      url: dbUrl,
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10) || 5432,
      name: process.env.DB_NAME || 'healthystudy_intranet_db',
      user: process.env.DB_USERNAME || 'postgres',
      pass: process.env.DB_PASSWORD || 'root',
      synchronize:
        process.env.DB_SYNCHRONIZE !== undefined
          ? process.env.DB_SYNCHRONIZE === 'true'
          : nodeEnv !== 'production',
      autoCreate:
        process.env.DB_AUTO_CREATE !== undefined
          ? process.env.DB_AUTO_CREATE === 'true'
          : nodeEnv !== 'production',
      migrationsRun:
        process.env.DB_RUN_MIGRATIONS !== undefined
          ? process.env.DB_RUN_MIGRATIONS === 'true'
          : true,
      ssl,
    },
    jwt: {
      secret:
        process.env.JWT_SECRET ||
        (nodeEnv !== 'production' ? 'super_secret_jwt_key_healthy_study_2026' : ''),
    },
    internalServiceSecret:
      process.env.INTERNAL_SERVICE_SECRET ||
      (nodeEnv !== 'production' ? 'cb-internal-secret-2026' : ''),
    externalApiKeys: parseExternalApiKeys(process.env.EXTERNAL_API_KEYS),
    mainBackendUrl: (
      process.env.MAIN_BACKEND_URL || 'http://localhost:3000'
    ).replace(/\/+$/, ''),
    mainUrl: (process.env.MAIN_URL || 'http://localhost:5173').replace(
      /\/+$/,
      '',
    ),
    notificationServiceUrl: (
      process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3002'
    ).replace(/\/+$/, ''),
    webhookUrl: (process.env.WEBHOOK_URL || '').trim(),
    webhookSecret: (process.env.WEBHOOK_SECRET || '').trim(),
    lostFoundArchiveDays:
      Number.isFinite(defaultArchiveDays) && defaultArchiveDays >= 1
        ? defaultArchiveDays
        : 45,
    imagekit: {
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY || '',
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY || '',
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || '',
    },
  };
};
