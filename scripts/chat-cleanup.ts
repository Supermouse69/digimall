// Run: bun run chat:cleanup
// Deletes chats past their delete date (Settings: "Delete chats after (days)"), except chats under
// a report. Same job as the daily /api/cron/chat-cleanup endpoint. Writes to the database.
import { getPayload } from "payload";

import config from "../src/payload.config";
import { purgeExpiredChats } from "../src/modules/chat/server/chat-service";

const payload = await getPayload({ config });
const result = await purgeExpiredChats({ payload });
console.log(`Deleted ${result.conversations} expired chat(s) and ${result.messages} message(s).`);
process.exit(0);
