import type { ReactNode } from 'react'
import type { ExtensionResource } from '../../../contracts/extension-presets.js'
import type { ExtensionTranslate } from './ExtensionPresetEntry.js'

export interface ExtensionDetailProps {
  resource: ExtensionResource
  t: ExtensionTranslate
  onClose: () => void
  checked?: boolean
  disabled?: boolean
  onToggle?: (enabled: boolean) => void
}

export type RenderExtensionDetail = (props: ExtensionDetailProps) => ReactNode
