import React, { useState } from 'react'
import { SfState } from './sf-state.tsx'

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
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (!error) return null
  const row = error as ApplicationError
  return <SfState kind="error" compact title="这一步未能完成" description={row.message}
    action={{ label: detailsOpen ? '收起问题详情' : '查看问题详情', onClick: () => setDetailsOpen(value => !value) }}>
    {detailsOpen && <div className="sf-state-details">
    <small>{row.code}{row.details?.operation && ` · ${row.details.operation}`}</small>
    {!!row.details?.fields?.length && <p>字段：{row.details.fields.join('、')}</p>}
    {row.details && <pre>{JSON.stringify(row.details, null, 2)}</pre>}
    {!row.code && <p>请根据提示调整输入，再重新提交这一步。</p>}
  </div>}</SfState>
}
