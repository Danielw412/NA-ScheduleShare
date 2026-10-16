import { useId, type ReactNode } from 'react'

export interface SegmentedOption<Value extends string> {
  value: Value
  label: ReactNode
  disabled?: boolean
}

interface SegmentedControlProps<Value extends string> {
  label: string
  value: Value
  options: SegmentedOption<Value>[]
  onChange: (value: Value) => void
  block?: boolean
  className?: string
}

/**
 * Mutually exclusive view switch built on native radio inputs, so arrow keys,
 * focus, and screen-reader semantics come from the platform.
 */
export function SegmentedControl<Value extends string>({ label, value, options, onChange, block = false, className }: SegmentedControlProps<Value>) {
  const name = useId()
  const classes = ['segmented', block ? 'is-block' : '', className ?? ''].filter(Boolean).join(' ')
  return (
    <div className={classes} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label className="segmented-option" key={option.value}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  )
}
