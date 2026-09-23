import { HttpError } from './errors.ts';
export type DateOnly = string;
export function dateOnly(value: unknown, field = 'dueDate'): DateOnly {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01') throw new HttpError(400, 'INVALID_INPUT', { [field]: '有効な日付を入力してください。' });
  const time = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time.getTime()) || time.toISOString().slice(0, 10) !== value) throw new HttpError(400, 'INVALID_INPUT', { [field]: '有効な日付を入力してください。' });
  return value;
}
export function jstToday(now = new Date()): DateOnly { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
export function addDays(day: DateOnly, days: number): DateOnly { return new Date(new Date(`${dateOnly(day)}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10); }
export function validateDueDate(value: unknown, now = new Date(), previous?: string): DateOnly {
  const day = dateOnly(value);
  if (day < jstToday(now) || (previous !== undefined && day <= dateOnly(previous))) throw new HttpError(400, 'INVALID_INPUT', { dueDate: '今日以降で、延長の場合は現在の予定日より後を指定してください。' });
  return day;
}
export type LoanStatus = 'active' | 'overdue' | 'returned';
export function loanStatus(dueDate: DateOnly, returnedAt: string | Date | null, now = new Date()): LoanStatus {
  return returnedAt ? 'returned' : dateOnly(dueDate) < jstToday(now) ? 'overdue' : 'active';
}
