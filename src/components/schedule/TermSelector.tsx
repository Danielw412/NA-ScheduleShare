import type { SemesterTerm } from '../../lib/domain'
import { SegmentedControl, type SegmentedOption } from '../ui/SegmentedControl'

const options: SegmentedOption<SemesterTerm>[] = [
  { value: 'semester_1', label: 'Semester 1' },
  { value: 'semester_2', label: 'Semester 2' },
]

interface TermSelectorProps {
  value: SemesterTerm
  onChange: (term: SemesterTerm) => void
  label?: string
  /** Stretch to the full width of the container. */
  block?: boolean
  className?: string
}

/** Semester switch for schedule grids, built on the shared segmented control. */
export function TermSelector({ value, onChange, label = 'Semester', block = false, className }: TermSelectorProps) {
  return (
    <SegmentedControl
      className={className ? `schedule-term-selector ${className}` : 'schedule-term-selector'}
      label={label}
      value={value}
      options={options}
      onChange={onChange}
      block={block}
    />
  )
}
