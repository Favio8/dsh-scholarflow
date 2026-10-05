import { invariant } from '../../shared/errors.ts'
import { walk, type AstNode } from '../editing/markdown.ts'

// Publication checks never redact or rewrite manuscript facts. The operator
// must explicitly edit and save a new revision before a refused export retries.
export function validateArtifactPrivacy(text: string) {
  invariant(!/\bsk-[a-zA-Z0-9_-]{12,}\b/u.test(text) &&
    !/(?:api[_ -]?key|authorization|password|secret|access[_ -]?token)\s*[:=]\s*(?:["']?)[^\s"'<>]{6,}/iu.test(text),
    'PRIVATE_CREDENTIAL_NOT_EXPORTABLE', '交付内容含可能的凭据，请在主稿或来源中明确删除后重新预检；未修改原稿。')
  invariant(!/(?:\b[a-z]:[\\/]|\\\\[^\s\\/]+[\\/]|\/(?:Users|home)\/[^\s/]+\/)/iu.test(text),
    'PRIVATE_PATH_NOT_EXPORTABLE', '交付内容含本地绝对路径，请明确改为可公开文字后重新预检；未修改原稿。')
}

export function validateExportUrl(value: string) {
  if (value.startsWith('#')) return
  invariant(/^(?:https?:|mailto:)/iu.test(value), 'LOCAL_RESOURCE_NOT_EXPORTABLE',
    '正文或来源含未打包的本地／相对资源或不支持的链接地址；请先明确改为公开 URL 或稿内锚点。当前交付不会复制原资料，也不会发布指向错误位置的链接。')
  let url: URL
  try { url = new URL(value) } catch { invariant(false, 'PUBLIC_LINK_INVALID', '正文或来源链接不是有效的公开 URL；请修改后重新预检。') }
  invariant(!url!.username && !url!.password && ![...url!.searchParams.keys()].some(key =>
    /^(?:api[_-]?key|access[_-]?token|token|secret|password|authorization|signature|x-amz-signature|x-goog-signature)$/iu.test(key)),
    'PRIVATE_CREDENTIAL_NOT_EXPORTABLE', '链接包含访问凭据或签名参数，请明确改为可公开 URL 后重新预检。')
  if (url!.protocol === 'http:' || url!.protocol === 'https:') invariant(!!url!.hostname, 'PUBLIC_LINK_INVALID', '公开链接缺少主机名。')
}

export function validateManuscriptPublication(text: string, tree: AstNode) {
  validateArtifactPrivacy(text)
  walk(tree, node => {
    invariant(!['image', 'imageReference'].includes(node.type), 'IMAGE_EXPORT_UNAVAILABLE',
      '当前导出器尚未验证图片资源；请先移除图片或等待已测试的资源导出支持。')
  })
  walk(tree, node => {
    invariant(node.type !== 'html', 'HTML_EXPORT_UNAVAILABLE', '当前导出尚未验证原始 HTML 内资源与隐私，请明确改为已支持的 Markdown 后重新预检。')
    if (['link', 'definition'].includes(node.type) && node.url) validateExportUrl(node.url)
  })
}
