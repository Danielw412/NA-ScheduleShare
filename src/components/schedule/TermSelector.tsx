import type { SemesterTerm } from '../../lib/domain'

const options: Array<{ value: SemesterTerm; label: string; compact: string }> = [
  { value: 'semester_1', label: 'Semester 1', compact: 'S1' },
  { value: 'semester_2', label: 'Semester 2', compact: 'S2' },
]

export function TermSelector({ value, onChange, label = 'View semester' }: { value: SemesterTerm; onChange: (term: SemesterTerm) => void; label?: string }) {
  return (
    <div className="term-selector" role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => (
        <button key={option.value} type="button" className={value === option.value ? 'is-active' : ''} aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          <span className="term-long">{option.label}</span><span className="term-short">{option.compact}</span>
        </button>
      ))}
    </div>
  )
}
