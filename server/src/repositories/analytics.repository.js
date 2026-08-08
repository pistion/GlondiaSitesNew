import { prisma } from '../services/db.js';

export function createAnalyticsEvents(events) {
  return prisma.$transaction(events.map((data) => prisma.analyticsEvent.create({ data })));
}
