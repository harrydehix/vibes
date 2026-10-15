import { nextTick, onScopeDispose, watch, type Ref } from 'vue'

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

/** Each opening captures its opener. Restoration waits for the background to lose `inert`. */
export function useDialogFocus(
  visible: () => boolean,
  dialog: Ref<HTMLElement | null>,
  initialFocus: () => HTMLElement | null | undefined,
  fallbackFocus: () => HTMLElement | null | undefined
): { trapFocus: (event: KeyboardEvent) => void } {
  let opener: HTMLElement | null = null
  let opened = false

  function controls(): HTMLElement[] {
    return Array.from(dialog.value?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        !element.closest('[hidden], [inert]')
    )
  }

  function restoreFocus(): void {
    if (!opened) return
    opened = false
    const previous = opener
    opener = null
    void nextTick(() => {
      const target = previous?.isConnected ? previous : fallbackFocus()
      target?.focus()
    })
  }

  watch(
    [visible, dialog],
    async ([isVisible], _previous, onCleanup) => {
      let cancelled = false
      onCleanup(() => {
        cancelled = true
      })
      if (!isVisible) {
        restoreFocus()
        return
      }
      if (!dialog.value) return
      if (!opened) {
        opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
        opened = true
      }
      await nextTick()
      if (cancelled) return
      const available = controls()
      const requested = initialFocus()
      const target =
        requested && available.includes(requested) ? requested : (available[0] ?? dialog.value)
      target?.focus()
    },
    { immediate: true, flush: 'post' }
  )

  function trapFocus(event: KeyboardEvent): void {
    const available = controls()
    const first = available[0]
    const last = available[available.length - 1]
    const active = document.activeElement
    if (!first) {
      event.preventDefault()
      dialog.value?.focus()
    } else if (!available.includes(active as HTMLElement)) {
      event.preventDefault()
      const target = event.shiftKey ? last : first
      target?.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  onScopeDispose(restoreFocus)
  return { trapFocus }
}
