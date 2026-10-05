import React from 'react'
export function ReadonlyProject({ value }: { value: any }) {
  const download = (file: any) => {
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([file.text], { type: 'text/plain;charset=utf-8' }))
    link.href = url; link.download = file.relativePath.split('/').at(-1); link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section aria-label="不兼容项目只读查看"><h3>{value.title} · 只读</h3>
    <p role="alert">项目版本高于当前插件支持范围。请使用兼容版本继续；这里可以查看、下载原始文件。</p>
    <p>配置版本 {value.versions.config} · ledger 版本 {value.versions.ledger ?? '未知'} · 资源锁版本 {value.versions.resourceLock ?? '未知'}</p>
    {value.warnings.map((warning: string, index: number) => <p role="status" key={index}>{warning}</p>)}
    {value.originals.map((file: any) => <details key={file.relativePath}><summary>{file.relativePath} · 原始文件</summary>
      <p>{file.contentHash}</p><pre>{file.text.slice(0, 64000)}{file.text.length > 64000 ? '\n[预览仅展示前64000字符；下载保留原文全文]' : ''}</pre>
      <button onClick={() => download(file)}>下载原始文件 {file.relativePath}</button></details>)}
  </section>
}
