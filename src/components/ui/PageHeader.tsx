import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
  titleId?: string
  className?: string
}

export function PageHeader({ title, description, actions, back, titleId, className }: PageHeaderProps) {
  return (
    <header className={className ? `page-header ${className}` : 'page-header'}>
      <div className="page-header-text">
        {back ? <Link className="back-link" to={back.to}><ChevronLeft aria-hidden="true" />{back.label}</Link> : null}
        <h1 id={titleId}>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header-actions">{actions}</div> : null}
    </header>
  )
}
