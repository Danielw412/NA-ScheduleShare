import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  centered?: boolean
  headingLevel?: 2 | 3
}

export function EmptyState({ icon: Icon, title, children, action, centered = false, headingLevel = 2 }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <div className={centered ? 'empty-state is-centered' : 'empty-state'}>
      {Icon ? <span className="empty-state-icon"><Icon aria-hidden="true" /></span> : null}
      <Heading>{title}</Heading>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  )
}
