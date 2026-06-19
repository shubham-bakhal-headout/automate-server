import db from '../db';

type FieldResult = { key: string; ok: boolean; error?: string };

/**
 * Mark a script FAILING only when the extension reports concrete field-level
 * failures (a field the script could no longer find/fill) — that is the signal
 * the vendor changed their form.
 *
 * A blanket FAILURE with no field data (tab closed, timeout, user-scripts
 * disabled, network) is an infrastructure problem, not a script-health problem,
 * so it must NOT flip the status — otherwise a transient glitch permanently
 * degrades a script that is actually fine.
 *
 * Conversely, a clean run (all fields ok) heals a previously FAILING script
 * back to ACTIVE.
 */
export async function updateScriptHealth(
  scriptId: string,
  fieldResults?: FieldResult[]
): Promise<void> {
  if (!Array.isArray(fieldResults) || fieldResults.length === 0) return;

  const hasBadFields = fieldResults.some((f) => !f.ok);

  await db.script.update({
    where: { id: scriptId },
    data: { status: hasBadFields ? 'FAILING' : 'ACTIVE' },
  });
}
