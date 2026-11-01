import { createLocalReq, initTransaction, type Payload, type PayloadRequest } from "payload";

// Starts a database transaction for server code (all-or-nothing writes).
// MongoDB quirk: if the FIRST command in a new transaction is a paged list (Payload sends "count" and
// "find" at the same moment), one of them can fail with "transaction number ... does not match",
// and the whole transaction is lost. One plain lookup first avoids that race.
export const startTransaction = async (payload: Payload): Promise<PayloadRequest> => {
  const req = await createLocalReq({}, payload);
  await initTransaction(req);
  await payload.db.findOne({ collection: "orders", where: { code: { equals: "__start__" } }, req });
  return req;
};
