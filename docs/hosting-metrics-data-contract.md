# Hosting metrics data contract

## Function statement

`getHostingMetrics(deploymentId, metricType, options)` returns normalized metrics for one managed Glondia hosting service and caches the provider samples into relational tables.

The function must:

1. Resolve `deploymentId` to the canonical `WebHostingService`.
2. Verify the hosting service has a real provider service id.
3. Fetch provider telemetry for the selected `metricType` and `range`.
4. Normalize provider payloads into `{ type, unit, range, resolution, data, usageThisMonthMb }`.
5. Store graph points in `hosting_metric_samples`.
6. Store monthly rollups in `hosting_usage_summaries`.
7. Return only UI-safe values to the client.

## Variables

| Variable | Meaning |
| --- | --- |
| `deploymentId` | Customer-facing hosting deployment id. Also maps to `WebHostingService.id`. |
| `hostingServiceId` | Canonical database id for the hosting service. |
| `renderServiceId` | Provider service id used to fetch live metrics. |
| `metricType` | Metric requested by the UI, currently `bandwidth`. |
| `range` | UI range key: `12h`, `24h`, or `7d`. |
| `resolution` | Provider/UI resolution, currently `hour` or `day`. |
| `sampleAt` | Timestamp for one chart point. |
| `value` | Numeric sample value normalized to the response unit. |
| `usageThisMonthMb` | Monthly bandwidth summary shown by the metrics tab. |

## Tables

- `hosting_metric_samples`: durable chart samples keyed by hosting service, metric type, range, and timestamp.
- `hosting_usage_summaries`: monthly usage rollups keyed by hosting service and period.
