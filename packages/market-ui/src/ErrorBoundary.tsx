/**
 * Error boundary for untrusted preview content.
 *
 * Skill/command/agent bodies and hook/LSP JSON are third-party content; a
 * renderer throw must degrade to a plain-text fallback instead of unmounting
 * the whole settings section (React has no built-in boundary).
 */
import { createElement as h, Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error) => ReactNode
}

interface State {
  error: Error | undefined
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: unknown): void {
    console.warn('[dsh-agent-plugins-market] preview render failed:', error, info)
  }

  override render(): ReactNode {
    if (this.state.error !== undefined) {
      return this.props.fallback === undefined
        ? h('pre', { className: 'dsh-agent-plugins-fallback' }, `预览渲染失败：${this.state.error.message}`)
        : this.props.fallback(this.state.error)
    }
    return this.props.children
  }
}
