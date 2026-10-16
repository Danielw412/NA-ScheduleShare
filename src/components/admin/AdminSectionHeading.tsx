import type { ReactNode } from 'react'

interface AdminSectionHeadingProps {
  id: string
  title: string
  count?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Heading level; sub-sections inside a section use h3. */
  level?: 2 | 3
}

/** The one heading pattern every administration section uses. */
export function AdminSectionHeading({ id, title, count, description, actions, level = 2 }: AdminSectionHeadingProps) {
  const Heading = level === 2 ? 'h2' : 'h3'
  return (
    <div className="section-header admin-section-header">
      <div>
        <div className="admin-heading-row">
          <Heading id={id}>{title}</Heading>
          {count !== undefined ? <span className="section-count">{count}</span> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="admin-section-actions">{actions}</div> : null}
    </div>
  )
}
