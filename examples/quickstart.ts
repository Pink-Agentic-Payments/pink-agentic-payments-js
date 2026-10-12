#!/usr/bin/env -S npx tsx
/**
 * Live end-to-end example against the real Pink Agentic AI Payments sandbox.
 *
 * Creates ONE sandbox workspace (test money, no signup), then shows the
 * three payment outcomes (allowed, blocked, pending human approval) and the
 * full human-approval lifecycle: request -> pending_human -> an admin
 * approves it -> a one-time credential is issued.
 *
 * Note: the sandbox's "coffee" template has a company-wide rule, "Between
 * 11pm and 6am: ask the owner" (America/Chicago). That rule is checked
 * against real wall-clock time for actual payments (POST /v1/payments),
 * even though you can pass localHour to override it for the dry-run check
 * (POST /v1/payments/check) -- this is a live-verified quirk, see
 * NOTES.md. If you run this script at night in Chicago, step 4 below may
 * come back pending_human instead of allowed; the script handles both
 * outcomes.
 *
 * Usage:
 *   npx tsx examples/quickstart.ts
 */
import {
  PinkClient,
  PinkApprovalPending,
  PinkPolicyDenied,
  approvePayment,
  createSandboxWorkspace,
  mcpConfig,
} from "../src/index.js";

async function main() {
  console.log("== 1. Create a sandbox workspace (coffee template) ==");
  const workspace = await createSandboxWorkspace({
    company: "pink-agentic-payments js quickstart",
    template: "coffee",
  });
  console.log("workspace_id:", workspace.workspace_id);
  const agents = Object.fromEntries(workspace.agents.map((a) => [a.id, a]));
  const adminKey = workspace.admin_key;
  const purchasingKey = agents["a_purch"].key;
  console.log("agents:", Object.keys(agents));

  const client = new PinkClient(purchasingKey);

  console.log("\n== 2. Identity + budget (Purchasing AI) ==");
  console.log(await client.getIdentity());
  console.log(await client.getBudget());

  console.log("\n== 3. Dry-run a small payment (would_allow expected) ==");
  const check = await client.checkPolicy({
    amount: 420,
    payeeId: "p_cc",
    purpose: "20kg espresso beans",
    localHour: 14,
  });
  console.log(check.decision, "-", check.reason);

  console.log("\n== 4. Request the same payment for real ==");
  let holdId: string | undefined;
  try {
    const result = await client.requestPayment({ amount: 420, payeeId: "p_cc", purpose: "20kg espresso beans" });
    console.log("decision: allowed | credential.type:", (result.credential as Record<string, unknown>).type);
  } catch (e) {
    if (e instanceof PinkApprovalPending) {
      holdId = e.payload.hold_id as string;
      console.log(
        "decision: pending_human | hold_id:",
        holdId,
        "| who:",
        e.payload.who,
        "| rule:",
        e.payload.rule,
      );
      console.log("(this happens outside 6am-11pm America/Chicago, see NOTES.md)");
    } else {
      throw e;
    }
  }

  console.log("\n== 5. BLOCKED: try to pay a blocked category (gift cards) ==");
  try {
    await client.requestPayment({ amount: 50, payeeName: "giftcards.com", purpose: "prizes" });
    console.log("UNEXPECTED: not blocked");
  } catch (e) {
    if (e instanceof PinkPolicyDenied) {
      console.log("decision: blocked | rule:", e.payload.rule);
    } else {
      throw e;
    }
  }

  if (holdId === undefined) {
    console.log("\n== 6. PENDING HUMAN: a payment above the single-payment cap to force approval ==");
    try {
      await client.requestPayment({ amount: 800, payeeId: "p_cc", purpose: "emergency bulk order" });
      console.log("UNEXPECTED: not pending");
    } catch (e) {
      if (e instanceof PinkApprovalPending) {
        holdId = e.payload.hold_id as string;
        console.log("decision: pending_human | hold_id:", holdId, "| who:", e.payload.who);
      } else {
        throw e;
      }
    }
  }

  console.log("\n== 7. Admin approves the pending hold (full approval lifecycle) ==");
  const approved = await approvePayment(adminKey, holdId as string, { by: "quickstart admin" });
  console.log(
    "decision:",
    approved.decision,
    "| credential.type:",
    (approved.credential as Record<string, unknown> | undefined)?.type,
  );

  console.log("\n== 8. Poll it again via getCredential (now resolved, no exception) ==");
  const final = await client.getCredential(holdId as string);
  console.log("decision:", final.decision, "| credential:", final.credential);

  console.log("\n== 9. Report a receipt for the approved payment ==");
  const receiptResult = await client.reportReceipt(holdId as string, {
    merchant: "Counter Culture Coffee",
    total: 420,
  });
  console.log(receiptResult);

  console.log("\n== 10. MCP config for this agent ==");
  console.log(JSON.stringify(mcpConfig(purchasingKey), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
