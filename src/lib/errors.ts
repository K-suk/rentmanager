export class HttpError extends Error {
  status: number; code: string; fields?: Record<string, string>;
  constructor(status: number, code: string, fields?: Record<string, string>) {
    super(code); this.status = status; this.code = code; this.fields = fields;
  }
}
export type ErrorEnvelope = { error: string; fields?: Record<string, string>; traceId?: string };
export const errorMessages: Record<string, string> = {
  INVALID_INPUT: '入力内容を確認してください。', UNAUTHENTICATED: 'ログインしてください。',
  EMPLOYEE_FORBIDDEN: 'この操作を行う権限がありません。', CONFLICT: '内容が変更されました。最新の状態を確認してください。',
  NOT_FOUND: '対象が見つかりません。', RATE_LIMITED: '操作が多いため、しばらく待ってから再試行してください。',
  SERVICE_UNAVAILABLE: '接続できません。時間をおいて再試行してください。',
  EQUIPMENT_LIMIT: '備品は100点まで登録できます。', EMPLOYEE_LIMIT: '社員は無効な社員を含め20人までです。',
  EMAIL_EXISTS: 'このメールアドレスは登録済みです。', ASSET_NUMBER_EXISTS: 'この管理番号は使用済みです。',
  PROTECTED_ADMIN: '初期管理者は変更できません。', LAST_ADMIN: '最後の有効な管理者は変更できません。',
  REACTIVATION_DISABLED: '無効な社員を再有効化することはできません。',
};
export function errorMessage(code: string) { return errorMessages[code] ?? '操作できませんでした。入力と権限を確認してください。'; }
