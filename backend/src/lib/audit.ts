import { query } from '../db/pool.js';
import { logger } from '../utils/logger.js';

/** Records security-relevant actions (role changes, suspensions, approvals, deletions) for audit. */
export async function audit(
  actorId: string | null | undefined,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  try {
    await query('INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [
      actorId ?? null,
      action,
      entity,
      entityId,
      JSON.stringify(metadata),
    ]);
  } catch (err) {
    logger.warn('Audit log write failed', { error: (err as Error).message });
  }
}
