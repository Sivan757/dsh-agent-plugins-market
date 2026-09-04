/** Shared switch control (ON = primary button fill, like every host toggle). */
import { createElement as h, type ReactNode } from 'react'
import css from '../market.module.css'

export interface ToggleSwitchProps {
  on: boolean
  disabled?: boolean
  title?: string
  onChange: () => void
}

/** A green/gray switch control for suite enable state. */
export function ToggleSwitch(props: ToggleSwitchProps): ReactNode {
  return h(
    'button',
    {
      type: 'button',
      role: 'switch',
      'aria-checked': props.on,
      title: props.title,
      disabled: props.disabled,
      className: props.on ? css.switchOn : css.switchOff,
      onClick: (event: { stopPropagation(): void }) => {
        event.stopPropagation()
        props.onChange()
      }
    },
    h('span', { className: css.switchThumb })
  )
}
