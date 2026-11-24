/**
 * Legacy compatibility alias for PitchIntel database verification.
 * PitchIntel uses Drizzle ORM exclusively as its authoritative database engine.
 * Prisma is not installed or used at runtime.
 * All functions are routed to the authoritative DatabaseClient in ./databaseClient.ts.
 */
export { DatabaseClient, dbClient, type DbConnectionStatus } from './databaseClient.ts';
