import type { ReactNode } from 'react'
import type { ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import type { ExtensionTranslate } from './types.js'

export interface ExtensionDetailProps {
  resource: ExtensionResource
  t: ExtensionTranslate
  /** The manager's panel-wide text view, so the dialog renders what the list shows. */
  showOriginal?: boolean
  onClose: () => void
  checked?: boolean
  disabled?: boolean
  onToggle?: (enabled: boolean) => void
}

export type RenderExtensionDetail = (props: ExtensionDetailProps) => ReactNode
