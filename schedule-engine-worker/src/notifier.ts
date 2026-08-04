import type { NotificationDelivery, ScheduleEngineInput } from './types.js'

export type PredictionReadyNotifier = (input: ScheduleEngineInput) => Promise<NotificationDelivery>

export const notifyPredictionReady: PredictionReadyNotifier = async () => {
  // ScheduleShare currently has authentication email templates but no
  // transactional application-email sender. A future integration belongs here.
  return { status: 'not_configured' }
}
