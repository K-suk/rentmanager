import { csrf, employee, failure, json, jsonBody, rateLimit } from '../../../lib/security.ts';
import { provision } from '../../../lib/provision.ts';
import { updateEmployee } from '../../../lib/operations.ts';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function POST(request: Request) {
  try { csrf(request); const actor=await employee(request.headers,true); await rateLimit('write',actor.id); const result=await provision(await jsonBody(request),actor.id); return json(result,201); } catch(error) { return failure(error); }
}
export async function PATCH(request: Request) {
  try { csrf(request); const actor=await employee(request.headers,true); await rateLimit('write',actor.id); return json(await updateEmployee(actor.id,await jsonBody(request))); } catch(error) { return failure(error); }
}
