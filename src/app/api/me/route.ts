import { employee, failure, json } from '../../../lib/security.ts';
export const runtime='nodejs'; export const dynamic='force-dynamic';
export async function GET(request: Request) { try { return json({employee:await employee(request.headers)}); } catch(error) { return failure(error); } }
