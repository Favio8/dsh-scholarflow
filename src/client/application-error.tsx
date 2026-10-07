import React from 'react'

export class ApplicationError extends Error {
  code: string
  details: { category?: string; operation?: string; fields?: string[]; [key: string]: unknown }
  constructor(error: { code: string; message: string; details?: ApplicationError['details'] }) {
    const field = error.details?.fields?.[0]
    super(error.code === 'INVALID_REQUEST' && (field === 'spec.targetLength' || field === 'targetLength') ? '目标篇幅需要填写有效整数（200～60000）。' : error.message)
    this.code = error.code; this.details = error.details ?? {}
  }
}
export function ErrorNotice({ error }: { error?: Error }) {
  if (!error) return null
  const row = error as ApplicationError
  return <div role="alert"><p>{row.message}</p>{row.code && <details><summary>查看详情</summary>
    <small>{row.code}{row.details?.operation && ` · ${row.details.operation}`}</small>
    {!!row.details?.fields?.length && <p>字段：{row.details.fields.join('、')}</p>}
    {row.details && <pre>{JSON.stringify(row.details, null, 2)}</pre>}
  </details>}</div>
}
