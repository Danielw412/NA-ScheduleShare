import type { AcademicTerm } from '../../lib/domain'

const options: Array<{ value: AcademicTerm; label: string; compact: string }> = [
  { value: 'full_year', label: 'Full Year', compact: 'Full Year' },
  { value: 'semester_1', label: 'Semester 1', compact: 'S1' },
  { value: 'semester_2', label: 'Semester 2', compact: 'S2' },
]

export function TermSelector({ value, onChange, label = 'View term' }: { value: AcademicTerm; onChange: (term: AcademicTerm) => void; label?: string }) {
  return (
    <div className="term-selector" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'is-active' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          <span className="term-long">{option.label}</span><span className="term-short">{option.compact}</span>
        </button>
      ))}
    </div>
  )
}
