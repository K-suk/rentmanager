import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { transaction } from './transactions.ts';
import { HttpError } from './errors.ts';
import { dateOnly, validateDueDate } from './dates.ts';
import { idempotencyKey, identifier, uuid, onlyKeys, object, role, text, validateEquipment } from './validation.ts';
export type LoanMutationResult = { id: string; dueDate: string; returnedAt: string | null; returnedBy: string | null };
type LoanRow = { id: string; equipment_id: string; borrower_id: string; due_date: string; returned_at: Date | null; returned_by: string | null };
function result(row: LoanRow): LoanMutationResult { return { id: row.id, dueDate: row.due_date, returnedAt: row.returned_at?.toISOString() ?? null, returnedBy: row.returned_by }; }
async function replay(client: PoolClient, actorId: string, key: string, kind: string, request: Record<string, string>): Promise<LoanMutationResult | null> {
  const old = (await client.query('SELECT kind,request,result FROM app_operation WHERE actor_id=$1 AND idempotency_key=$2', [actorId, key])).rows[0];
  if (!old) return null;
  if (old.kind !== kind || JSON.stringify(Object.entries(old.request).sort()) !== JSON.stringify(Object.entries(request).sort())) throw new HttpError(409, 'CONFLICT');
  return old.result as LoanMutationResult;
}
async function remember(client: PoolClient, actorId: string, key: string, kind: string, request: Record<string, string>, value: LoanMutationResult) {
  await client.query('INSERT INTO app_operation(actor_id,idempotency_key,kind,request,result) VALUES($1,$2,$3,$4,$5)', [actorId, key, kind, request, value]); return value;
}
async function lockEquipment(client: PoolClient, id: string) {
  const row = (await client.query('SELECT * FROM equipment WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND'); return row;
}
async function lockLoan(client: PoolClient, id: string): Promise<LoanRow> {
  const reference = (await client.query('SELECT equipment_id FROM loan WHERE id=$1', [id])).rows[0];
  if (!reference) throw new HttpError(404, 'NOT_FOUND');
  await lockEquipment(client, reference.equipment_id);
  return (await client.query('SELECT *,due_date::text FROM loan WHERE id=$1 FOR UPDATE', [id])).rows[0] as LoanRow;
}
export async function borrowEquipment(actorId: string, input: unknown): Promise<LoanMutationResult> {
  const v = object(input); onlyKeys(v, ['equipmentId','dueDate','idempotencyKey']); const request = { equipmentId: uuid(v.equipmentId), dueDate: dateOnly(v.dueDate) }; const key = idempotencyKey(v.idempotencyKey);
  return transaction(actorId, false, async (client, actor) => {
    const old = await replay(client, actor.id, key, 'borrow', request); if (old) return old;
    validateDueDate(request.dueDate);
    const equipment = await lockEquipment(client, request.equipmentId);
    if (equipment.deleted_at || (await client.query('SELECT 1 FROM loan WHERE equipment_id=$1 AND returned_at IS NULL', [request.equipmentId])).rowCount) throw new HttpError(409, 'CONFLICT');
    const row = (await client.query(`INSERT INTO loan(id,equipment_id,borrower_id,due_date,asset_number_snapshot,equipment_name_snapshot,borrower_name_snapshot)
      VALUES($1,$2,$3,$4,'','','') RETURNING *,due_date::text`, [randomUUID(), request.equipmentId, actor.id, request.dueDate])).rows[0] as LoanRow;
    return remember(client, actor.id, key, 'borrow', request, result(row));
  });
}
export async function returnLoan(actorId: string, input: unknown): Promise<LoanMutationResult> {
  const v = object(input); onlyKeys(v, ['loanId','expectedDueDate','idempotencyKey']); const request = { loanId: uuid(v.loanId), expectedDueDate: dateOnly(v.expectedDueDate, 'expectedDueDate') }; const key = idempotencyKey(v.idempotencyKey);
  return transaction(actorId, false, async (client, actor) => {
    const old = await replay(client, actor.id, key, 'return', request); if (old) return old;
    const row = await lockLoan(client, request.loanId);
    if (row.borrower_id !== actor.id && actor.role !== 'admin') throw new HttpError(403, 'EMPLOYEE_FORBIDDEN');
    if (!row.returned_at) {
      if (row.due_date !== request.expectedDueDate) throw new HttpError(409, 'CONFLICT');
      const updated = (await client.query('UPDATE loan SET returned_at=now(),returned_by=$2 WHERE id=$1 RETURNING *,due_date::text', [row.id, actor.id])).rows[0] as LoanRow;
      return remember(client, actor.id, key, 'return', request, result(updated));
    }
    return remember(client, actor.id, key, 'return', request, result(row));
  });
}
export async function extendLoan(actorId: string, input: unknown): Promise<LoanMutationResult> {
  const v = object(input); onlyKeys(v, ['loanId','expectedDueDate','dueDate','idempotencyKey']); const request = { loanId: uuid(v.loanId), expectedDueDate: dateOnly(v.expectedDueDate, 'expectedDueDate'), dueDate: dateOnly(v.dueDate) }; const key = idempotencyKey(v.idempotencyKey);
  return transaction(actorId, false, async (client, actor) => {
    const old = await replay(client, actor.id, key, 'extend', request); if (old) return old;
    const row = await lockLoan(client, request.loanId);
    if (row.borrower_id !== actor.id && actor.role !== 'admin') throw new HttpError(403, 'EMPLOYEE_FORBIDDEN');
    if (row.returned_at || row.due_date !== request.expectedDueDate) throw new HttpError(409, 'CONFLICT');
    validateDueDate(request.dueDate, new Date(), row.due_date);
    await client.query('INSERT INTO loan_extension(id,loan_id,old_due_date,new_due_date,actor_id,actor_name_snapshot,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), row.id, row.due_date, request.dueDate, actor.id, actor.name, key]);
    const updated = (await client.query('UPDATE loan SET due_date=$2 WHERE id=$1 RETURNING *,due_date::text', [row.id, request.dueDate])).rows[0] as LoanRow;
    return remember(client, actor.id, key, 'extend', request, result(updated));
  });
}
export async function createEquipment(actorId: string, input: unknown): Promise<{ id: string }> {
  const v = object(input); onlyKeys(v, ['assetNumber','name','category','description']); const value = validateEquipment(v);
  return transaction(actorId, true, async client => {
    await client.query('SELECT pg_advisory_xact_lock(741003)');
    const id = randomUUID(); await client.query('INSERT INTO equipment(id,asset_number,name,category,description) VALUES($1,$2,$3,$4,$5)', [id, value.assetNumber, value.name, value.category, value.description]); return { id };
  });
}
export async function updateEquipment(actorId: string, input: unknown): Promise<{ id: string }> {
  const v = object(input); onlyKeys(v, ['id','assetNumber','name','category','description']); const id = uuid(v.id); const value = validateEquipment(v);
  return transaction(actorId, true, async client => {
    const row = await lockEquipment(client, id);
    if (row.deleted_at || row.asset_number !== value.assetNumber) throw new HttpError(409, 'CONFLICT');
    await client.query('UPDATE equipment SET name=$2,category=$3,description=$4,updated_at=now() WHERE id=$1', [id, value.name, value.category, value.description]); return { id };
  });
}
export async function deleteEquipment(actorId: string, input: unknown): Promise<{ id: string }> {
  const v = object(input); onlyKeys(v, ['id']); const id = uuid(v.id);
  return transaction(actorId, true, async client => {
    const row = await lockEquipment(client, id);
    if (!row.deleted_at) {
      if ((await client.query('SELECT 1 FROM loan WHERE equipment_id=$1 AND returned_at IS NULL', [id])).rowCount) throw new HttpError(409, 'CONFLICT');
      await client.query('UPDATE equipment SET deleted_at=now(),updated_at=now() WHERE id=$1', [id]);
    }
    return { id };
  });
}
export async function updateEmployee(actorId: string, input: unknown): Promise<{ ok: true }> {
  const v = object(input); onlyKeys(v, ['id','name','role','active']); const id = identifier(v.id); const nextRole = role(v.role);
  if (typeof v.active !== 'boolean') throw new HttpError(400, 'INVALID_INPUT');
  const active = v.active; const name = v.name === undefined ? undefined : text(v.name, 'name');
  return transaction(actorId, true, async client => {
    const row = (await client.query('SELECT * FROM employee WHERE auth_user_id=$1 FOR UPDATE', [id])).rows[0];
    if (!row) throw new HttpError(404, 'NOT_FOUND');
    if (row.protected) throw new HttpError(403, 'PROTECTED_ADMIN');
    if (!row.active && active) throw new HttpError(403, 'REACTIVATION_DISABLED');
    await client.query('UPDATE employee SET name=$2,role=$3,active=$4,updated_at=now() WHERE auth_user_id=$1', [id, name ?? row.name, nextRole, active]); return { ok: true };
  });
}
