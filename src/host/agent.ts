// This entry is mounted ONLY under ScholarFlow's preset scope.
// Restricted inherited capabilities cannot bypass Proposal / FileGateway.
export const name = 'scholarflow-agent'
export const inject = ['tools']
export function apply(ctx: any) {
  ctx.effect(() => ctx.tools.restrict({ allow: [] }), 'scholarflow: restrict inherited tools')
  ctx.effect(() => ctx.tools.guard((exec: any) => exec.name.startsWith('scholar_')
    ? undefined : 'ScholarFlow only permits its controlled academic tools.'), 'scholarflow: academic tool guard')
}
