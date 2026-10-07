import type { ReactNode } from 'react'
import type { ExtensionResource } from '../../../../market-contracts/src/contracts/extension-presets.js'
import type { ExtensionTranslate } from './types.js'

export interface ExtensionDetailProps {
  resource: ExtensionResource
  t: ExtensionTranslate
  onClose: () => void
  checked?: boolean
  disabled?: boolean
  onToggle?: (enabled: boolean) => void
}

export type RenderExtensionDetail = (props: ExtensionDetailProps) => ReactNode
