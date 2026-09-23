import { HttpError } from './errors.ts';
export const categories = ['パソコン', 'モニター', 'カメラ', '周辺機器', 'その他'] as const;
export type Category = typeof categories[number];
export type Role = 'admin' | 'employee';
export type EmployeeInput = { email: string; password: string; name: string; role: Role };
export function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'INVALID_INPUT'); return value as Record<string, unknown>; }
export function text(value: unknown, field: string, max = 100, min = 1): string {
  if (typeof value !== 'string') throw new HttpError(400, 'INVALID_INPUT', { [field]: '文字を入力してください。' });
  const result = value.trim();
  if ([...result].length < min || [...result].length > max) throw new HttpError(400, 'INVALID_INPUT', { [field]: `${min}〜${max}文字で入力してください。` });
  return result;
}
export function role(value: unknown): Role { if (value !== 'employee' && value !== 'admin') throw new HttpError(400, 'INVALID_INPUT', { role: '権限を選択してください。' }); return value; }
export function identifier(value: unknown, field = 'id'): string { return text(value, field, 128); }
export function idempotencyKey(value: unknown): string { const key = text(value, 'idempotencyKey', 128); if (!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw new HttpError(400, 'INVALID_INPUT', { idempotencyKey: '操作識別子が不正です。' }); return key; }
export function validateEmployee(input: unknown): EmployeeInput {
  const value = object(input); onlyKeys(value, ['email','password','name','role']); const email = text(value.email, 'email', 254).toLowerCase(); const name = text(value.name, 'name');
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@example\.com$/.test(email)) throw new HttpError(400, 'INVALID_INPUT', { email: 'example.comの架空メールを入力してください。' });
  if (typeof value.password !== 'string' || value.password.length < 12 || value.password.length > 128) throw new HttpError(400, 'INVALID_INPUT', { password: '12〜128文字で入力してください。' });
  return { email, name, password: value.password, role: role(value.role) };
}
export type EquipmentInput = { assetNumber: string; name: string; category: Category; description: string };
export function validateEquipment(input: unknown): EquipmentInput {
  const value = object(input); const assetNumber = text(value.assetNumber, 'assetNumber', 32).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(assetNumber)) throw new HttpError(400, 'INVALID_INPUT', { assetNumber: '英数字・ハイフンで入力してください。' });
  if (!categories.includes(value.category as Category)) throw new HttpError(400, 'INVALID_INPUT', { category: 'カテゴリを選択してください。' });
  return { assetNumber, name: text(value.name, 'name'), category: value.category as Category, description: text(value.description ?? '', 'description', 1000, 0) };
}

export function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, 'INVALID_INPUT');
}
export function uuid(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'INVALID_INPUT', { [field]: '識別子が不正です。' });
  return value.toLowerCase();
}
