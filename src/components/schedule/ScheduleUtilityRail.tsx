import { Lightbulb } from 'lucide-react'

export function ScheduleUtilityRail() {
  return (
    <aside className="schedule-utility-rail">
      <section className="utility-panel tip-panel"><Lightbulb aria-hidden="true" /><div><h2>Tip</h2><p>Some classes use different periods on A and B days. Confirm every meeting slot before adding one.</p></div></section>
    </aside>
  )
}
