const mongoose = require("mongoose");

/**
 * Transactional wrapper that gracefully degrades on standalone Mongo.
 *
 * Behavior:
 *  - On a replica set / mongos, opens a session, starts a transaction,
 *    commits/aborts atomically. `fn(session)` receives the session — pass
 *    it to every read/write inside.
 *  - On a standalone server (no transactions support), executes `fn(null)`
 *    without a transaction. Callers that perform multi-doc writes should
 *    still pass `session` everywhere because the helper functions in
 *    `stockOps.js` accept `null` cleanly.
 *
 * The first time a transaction fails because the topology doesn't support
 * one, we cache that and stop trying — every subsequent call uses the
 * fallback path immediately, avoiding the per-request overhead.
 */

let transactionsSupported = null; // tri-state: null=unknown, true, false

const txErrorCodes = new Set([
  20, // IllegalOperation: transactions not supported
  263, // CommandNotSupportedInTransactions
]);

const isTransactionUnsupported = (err) => {
  if (!err) return false;
  if (typeof err.codeName === "string") {
    const cn = err.codeName;
    if (cn === "IllegalOperation" || cn === "Location20") return true;
  }
  if (typeof err.code === "number" && txErrorCodes.has(err.code)) return true;
  const msg = String(err.message || "");
  return (
    msg.includes("Transaction numbers are only allowed") ||
    msg.includes("standalone instances do not support") ||
    msg.includes("replica set member or mongos") ||
    msg.includes("does not support transactions")
  );
};

const withTransaction = async (fn) => {
  if (transactionsSupported === false) {
    return fn(null);
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    transactionsSupported = true;
    return result;
  } catch (err) {
    if (isTransactionUnsupported(err)) {
      transactionsSupported = false;
      // Fall back to non-transactional execution.
      try {
        return await fn(null);
      } finally {
        // session ended below
      }
    }
    throw err;
  } finally {
    await session.endSession().catch(() => {});
  }
};

const supportsTransactions = () => transactionsSupported === true;

module.exports = { withTransaction, supportsTransactions };
