import { Globe2, Lock, Users, type LucideIcon } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import type { PrivacySetting } from '../../lib/domain'

interface PrivacyOption {
  value: PrivacySetting
  title: string
  description: string
  Icon: LucideIcon
}

/**
 * The three schedule privacy levels, from most open to most private. The
 * database enforces them; this copy only explains the consequence.
 */
const privacyOptions: PrivacyOption[] = [
  { value: 'school', title: 'Anyone', description: 'Any student on ScheduleShare can see your full schedule.', Icon: Globe2 },
  { value: 'classmates', title: 'Classmates', description: 'Students who share a class with you can see your full schedule.', Icon: Users },
  { value: 'private', title: 'Private', description: 'Only students you approve can see your full schedule. Others can still see that they share a class with you.', Icon: Lock },
]

interface PrivacyOptionsProps {
  value: PrivacySetting
  onChange: (value: PrivacySetting) => void
  legend: ReactNode
  /** Hide the legend visually when a section heading already names the group. */
  hideLegend?: boolean
  disabled?: boolean
}

export function PrivacyOptions({ value, onChange, legend, hideLegend = false, disabled = false }: PrivacyOptionsProps) {
  const name = useId()
  return (
    <fieldset className="account-choice-set" disabled={disabled}>
      <legend className={hideLegend ? 'sr-only' : undefined}>{legend}</legend>
      <div className="account-choices">
        {privacyOptions.map(({ value: optionValue, title, description, Icon }) => (
          <label className="account-choice" key={optionValue}>
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} />
            <span className="account-choice-text">
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
            <Icon className="account-choice-icon" aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
