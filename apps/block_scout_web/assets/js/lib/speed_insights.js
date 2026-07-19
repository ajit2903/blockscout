// Vercel Speed Insights integration
// This tracks web vitals and performance metrics
import { injectSpeedInsights } from '@vercel/speed-insights'

// Initialize Speed Insights
// Only runs in production (package automatically disables tracking in dev mode)
if (typeof window !== 'undefined') {
  injectSpeedInsights({
    debug: process.env.NODE_ENV === 'development'
  })
}
