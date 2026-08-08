import { captureUxEvents } from '../services/uxAnalyticsService.js';

const EventTrackingController = {
  trackEvent: async (req, res) => {
    try {
      const result = await captureUxEvents({ userId: req.user.id, events: [{ ...req.body, metadata: req.body.metadata || req.body.properties }] });
      res.status(202).json({ data: result, requestId: req.id });
    } catch (error) { res.status(400).json({ error: { code: 'ANALYTICS_INVALID_EVENT', message: error.message }, requestId: req.id }); }
  },

  trackBatch: async (req, res) => {
    try {
      const result = await captureUxEvents({ userId: req.user.id, events: req.body?.events });
      res.status(202).json({ data: result, requestId: req.id });
    } catch (error) { res.status(400).json({ error: { code: 'ANALYTICS_INVALID_BATCH', message: error.message }, requestId: req.id }); }
  }
};

export default EventTrackingController;
