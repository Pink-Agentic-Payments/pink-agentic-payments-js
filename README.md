# pink-agentic-payments

[![npm version](https://img.shields.io/npm/v/pink-agentic-payments.svg)](https://www.npmjs.com/package/pink-agentic-payments)

Pink Agentic AI Payments lets AI agents pay within spending rules you set: every payment is checked against per-agent budgets, caps, payee allow-lists and approval rules before a single-use credential is issued.

This is the JavaScript/TypeScript client for Pink Agentic AI Payments by PinkWallet, published by the Pink team. Version 0.1 targets the public **sandbox**. The sandbox is free, needs no signup, uses test money only, and is meant for building and demoing agent integrations. Production is early access; see pinkwallet.com/agentic.

Design partners wanted: free hands-on setup and early access during the design-partner period, at [agentic-sandbox.pinkwallet.com/demo](https://agentic-sandbox.pinkwallet.com/demo). Reach us at [support@pinkwallet.com](mailto:support@pinkwallet.com) or open an issue titled "Design partner" in this repo.

## Install

```bash
npm install pink-agentic-payments
```

Alternatively, install straight from GitHub:

```bash
npm install github:Pink-Agentic-Payments/pink-agentic-payments-js
```

Zero runtime dependencies. Requires Node.js >= 18 (uses the global `fetch`).

## Quickstart

This really runs against the live sandbox (no signup, no API key to request in advance):

```ts
import { createSandboxWorkspace, PinkClient, PinkPolicyDenied, PinkApprovalPending } from "pink-agentic-payments";

// 1. Spin up a free sandbox workspace (test money, seeded with agents/payees/rules)
const workspace = await createSandboxWorkspace({ company: "My Test Co", template: "coffee" });
const agentKey = workspace.agents[0].key; // e.g. "Purchasing AI"
console.log("workspace:", workspace.workspace_id);

const client = new PinkClient(agentKey);

// 2. Dry-run a payment (no spend, no side effects)
const check = await client.checkPolicy({ amount: 420, payeeId: "p_cc", purpose: "beans" });
console.log(check.decision, "-", check.reason); // would_allow - Small supply orders go through

// 3. Make a real (sandbox) payment
try {
  const result = await client.requestPayment({ amount: 420, payeeId: "p_cc", purpose: "beans" });
  console.log("allowed, credential:", result.credential.type);
} catch (e) {
  if (e instanceof PinkApprovalPending) {
    console.log("pending human approval:", e.payload.who);
  } else if (e instanceof PinkPolicyDenied) {
    console.log("blocked:", e.payload.rule);
  } else {
    throw e;
  }
}
```

## The three outcomes

Every payment request resolves to one of three decisions, each a different HTTP status from the sandbox:

| Decision | HTTP | What happens | Client behavior |
|---|---|---|---|
| `allowed` | 201 | A one-time sandbox credential (card or bank transfer) is issued immediately | `requestPayment()` returns the result |
| `pending_human` | 202 | A human must approve in `/console` or via the admin API | `requestPayment()` throws `PinkApprovalPending` |
| `blocked` | 403 | No credential, ever, for this exact request | `requestPayment()` throws `PinkPolicyDenied` |

Real sandbox output captured while building this package (run `examples/quickstart.ts` to reproduce it):

```
allowed:  payment_id=pay_... decision=allowed credential.type=bank_transfer
blocked:  payment_id=pay_... decision=blocked rule="Never: gift cards, cash-like, crypto"
pending:  payment_id=pay_... decision=pending_human who="Luis Ortega (Store manager)"
```

## Using it as an MCP server instead

The same sandbox is also a remote MCP server at `/mcp`, with tools `pink.get_budget`, `pink.list_payees`, `pink.list_rules`, `pink.check_policy`, `pink.request_payment`, `pink.get_credential`, `pink.report_receipt`. Get a ready-to-paste client config:

```ts
import { mcpConfig } from "pink-agentic-payments";
console.log(JSON.stringify(mcpConfig(agentKey), null, 2));
```

```json
{
  "mcpServers": {
    "pink-agentic-payments-sandbox": {
      "type": "streamableHttp",
      "url": "https://agentic-sandbox.pinkwallet.com/mcp",
      "headers": { "Authorization": "Bearer pk_sandbox_agent_..." },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

This is the remote-MCP-over-HTTP config shape documented for Cline; Claude Desktop and Cursor accept the same `url` + `headers` shape for remote MCP servers.

## Sandbox vs. production

- Everything this client talks to is the **public sandbox**: test credentials (`pk_sandbox_agent_...` / `pk_sandbox_admin_...`), seeded fake balances, one-time fake cards/transfers. No real money ever moves.
- Production for Pink Agentic AI Payments is **early access** (waitlist, not yet generally available): pinkwallet.com/agentic.
- Workspaces and keys created in the sandbox can appear/disappear without notice; do not rely on them for anything but development and demos.

## API

- `createSandboxWorkspace(options?)`: create a free sandbox workspace.
- `new PinkClient(agentKey, options?)`: `getIdentity()`, `getBudget()`, `listPayees()`, `listVaults()`, `listRules()`, `checkPolicy(input)`, `requestPayment(input)`, `getPayment(id)`, `getCredential(id)`, `reportReceipt(id, receipt)`.
- `approvePayment(adminKey, paymentId, options?)` / `declinePayment(adminKey, paymentId, options?)`: admin-key operations for a `pending_human` hold.
- `mcpConfig(agentKey, baseUrl?)`: returns an MCP client config object.
- Errors: `PinkError` (base, has `.statusCode` and `.payload`), `PinkPolicyDenied` (403, blocked), `PinkApprovalPending` (202, pending human approval).

## Links

- Docs: https://pinkwallet.com/agentic/developers/
- Live demo (no signup): https://agentic-sandbox.pinkwallet.com/demo
- Python client for the same sandbox: https://github.com/Pink-Agentic-Payments/pink-agentic-payments-python
- Example clients in other frameworks (curl, Node MCP SDK, LangGraph, OpenAI Agents SDK, CrewAI, Vercel AI SDK, Haystack): https://github.com/Pink-Agentic-Payments/sandbox-examples
- Open challenge against the sandbox: https://github.com/Pink-Agentic-Payments/overspend-challenge

## Development

```bash
npm install
npm run build
npm test
npm run quickstart  # hits the live sandbox, creates one workspace
```

## License

MIT, see `LICENSE`.
