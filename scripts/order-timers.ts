// Run: bun run orders:timers
// Same job as /api/cron/order-timers: order timers, refund timers and repeated reminders.
// Writes to the database (and sends push notifications if anyone turned them on).
import { getPayload } from "payload";

import config from "../src/payload.config";
import { runOrderTimers } from "../src/modules/orders/server/order-service";
import { expireStaleRiderRequests } from "../src/modules/trips/server/trip-service";

const payload = await getPayload({ config });
const riderRequests = await expireStaleRiderRequests({ payload });
const counts = await runOrderTimers({ payload });
console.log("Order timers done:", { riderRequests, ...counts });
process.exit(0);
