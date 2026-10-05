import { useEffect, type RefObject } from 'react'

// The workbench previews are nonmodal: the Host conversation remains reachable.
// Give keyboard users an entry point and return to their actual initiating
// control after dismissal without trapping focus or silently accepting a plan.
export function useConfirmationFocus(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scope = root.current
    if (!scope) return
    const visible = (element: HTMLElement) => element.isConnected && element.getClientRects().length > 0
    const dialogs = new Map<HTMLElement, HTMLElement | null>()
    let restore: HTMLElement | null = null, lastAction: HTMLElement | null = null, frame = 0
    // An asynchronous preview disables its button while awaiting the Host;
    // browsers may move focus to body before the dialog is rendered.
    const rememberAction = (event: MouseEvent) => {
      const button = event.target instanceof Element ? event.target.closest<HTMLElement>('button') : null
      if (button && scope.contains(button)) lastAction = button
    }
    const update = () => {
      frame = 0
      for (const [dialog, trigger] of dialogs) if (!scope.contains(dialog) || !visible(dialog)) {
        dialogs.delete(dialog)
        if (trigger && scope.contains(trigger) && visible(trigger)) restore = trigger
      }
      for (const dialog of scope.querySelectorAll<HTMLElement>('[role="dialog"]')) {
        if (!visible(dialog) || dialogs.has(dialog)) continue
        const trigger = document.activeElement instanceof HTMLElement && scope.contains(document.activeElement) ? document.activeElement : lastAction
        dialogs.set(dialog, trigger); dialog.tabIndex = -1; dialog.setAttribute('aria-modal', 'false')
        dialog.focus({ preventScroll: true }); dialog.scrollIntoView({ block: 'nearest' }); restore = null
      }
      if (restore && !restore.matches(':disabled')) { restore.focus({ preventScroll: true }); restore = null }
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    const observer = new MutationObserver(schedule)
    observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] })
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const active = document.activeElement
      const dialog = [...dialogs.keys()].reverse().find(dialog => active instanceof Node && dialog.contains(active))
      if (!dialog) return
      const dismiss = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(button =>
        !button.disabled && visible(button) && /^(取消|关闭|返回)/u.test(button.textContent?.trim() ?? ''))
      if (dismiss) { event.preventDefault(); event.stopPropagation(); dismiss.click() }
    }
    scope.addEventListener('click', rememberAction, true); scope.addEventListener('keydown', escape); schedule()
    return () => { observer.disconnect(); scope.removeEventListener('click', rememberAction, true); scope.removeEventListener('keydown', escape); cancelAnimationFrame(frame) }
  }, [root])
}
