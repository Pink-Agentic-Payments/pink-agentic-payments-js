/** Errors for the Pink Agentic AI Payments sandbox client. */

export class PinkError extends Error {
  statusCode: number;
  payload: Record<string, unknown>;

  constructor(statusCode: number, message: string, payload: Record<string, unknown> = {}) {
    super(`HTTP ${statusCode}: ${message}`);
    this.name = "PinkError";
    this.statusCode = statusCode;
    this.payload = payload;
  }
}

/**
 * A payment was blocked by policy (decision=blocked, HTTP 403).
 * `payload` is the full PaymentResult body, including `rule` and `why`
 * describing which rule matched.
 */
export class PinkPolicyDenied extends PinkError {
  constructor(payload: Record<string, unknown>) {
    const reason = (payload.rule as string) || (payload.why as string) || "blocked by policy";
    super(403, reason, payload);
    this.name = "PinkPolicyDenied";
  }
}

/**
 * A payment is awaiting human approval (decision=pending_human, HTTP 202).
 * `payload` includes `hold_id` (poll with PinkClient.getCredential or
 * GET /v1/payments/{id}), `who` (the approver) and `expires_at`.
 */
export class PinkApprovalPending extends PinkError {
  constructor(payload: Record<string, unknown>) {
    const who = (payload.who as string) || "a human approver";
    super(202, `pending approval from ${who}`, payload);
    this.name = "PinkApprovalPending";
  }
}
