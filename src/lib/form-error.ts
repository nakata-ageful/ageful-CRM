/** Display only. Keep validation, retries and save outcomes in their existing writers. */
export function errorDetail(error:unknown):string {
  const text=error instanceof Error?error.message:typeof error==='string'?error:
    error&&typeof error==='object'&&'message'in error?String(error.message):''
  return text.replace(/^Error:\s*/, '').trim()
}
export function formErrorText(error:unknown):string {
  const text=errorDetail(error)
  if(!text)return '処理結果を確認できませんでした。接続状況を確認してください。'
  if(/[\u3040-\u30ff\u3400-\u9fff]/.test(text))return text
  if(/failed to fetch|network|load failed|timeout|timed out|connection/i.test(text))return '通信できませんでした。接続状況を確認してください。保存操作の直後なら、一覧で保存結果を確認してから次の操作をしてください。'
  if(/jwt|session.*expired|not authenticated|invalid.*token/i.test(text))return 'ログイン状態を確認できません。入力中の内容を控えてから、ログインし直してください。'
  if(/permission denied|row.level security|not authorized/i.test(text))return 'この操作を行う権限を確認できません。ログイン中のアカウントを確認してください。'
  return '処理を完了できませんでした。入力内容と接続状況を確認してください。'
}
