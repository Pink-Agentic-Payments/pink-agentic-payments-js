/**
 * Unit tests for pink-agentic-payments, mocked against the response shapes
 * documented in sandbox-examples/openapi/openapi.yaml (captured live on
 * 2026-10-01). No network calls.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  PinkClient,
  PinkError,
  PinkApprovalPending,
  PinkPolicyDenied,
  createSandboxWorkspace,
  approvePayment,
  mcpConfig,
} from "../src/index.js";

type FetchCall = { url: string; init: RequestInit };

let calls: FetchCall[] = [];
let originalFetch: typeof fetch;

function mockFetchOnce(status: number, payload: unknown) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(payload), { status }) as unknown as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("getBudget sends bearer token and user-agent", async () => {
  const budget = {
    agent: "Purchasing AI",
    status: "active",
    monthly_budget: 4000,
    spent_this_month: 2260,
    left_this_month: 1740,
    single_payment_cap: 500,
  };
  mockFetchOnce(200, budget);
  const client = new PinkClient("pk_sandbox_agent_test");
  const result = await client.getBudget();
  assert.deepEqual(result, budget);
  assert.equal(calls[0].url, "https://agentic-sandbox.pinkwallet.com/v1/budget");
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer pk_sandbox_agent_test");
  assert.match(headers["User-Agent"], /pink-agentic-payments-js/);
});

test("requestPayment allowed returns the credential", async () => {
  const allowed = {
    payment_id: "pay_e30e798f2466",
    decision: "allowed",
    agent: "Purchasing AI",
    payee: "Counter Culture Coffee",
    amount: 420,
    credential: { type: "bank_transfer", sandbox: true, single_use: true },
  };
  mockFetchOnce(201, allowed);
  const client = new PinkClient("pk_sandbox_agent_test");
  const result = await client.requestPayment({ amount: 420, payeeId: "p_cc", purpose: "beans" });
  assert.equal(result.decision, "allowed");
  assert.equal((result.credential as Record<string, unknown>).sandbox, true);
});

test("requestPayment pending_human throws PinkApprovalPending", async () => {
  const pending = {
    payment_id: "pay_1757bdd8acba",
    decision: "pending_human",
    hold_id: "pay_1757bdd8acba",
    who: "Luis Ortega (Store manager)",
  };
  mockFetchOnce(202, pending);
  const client = new PinkClient("pk_sandbox_agent_test");
  await assert.rejects(
    () => client.requestPayment({ amount: 890, payeeId: "p_sysco" }),
    (err: unknown) => {
      assert.ok(err instanceof PinkApprovalPending);
      assert.equal(err.payload.hold_id, "pay_1757bdd8acba");
      assert.match(err.message, /Luis Ortega/);
      return true;
    },
  );
});

test("requestPayment blocked throws PinkPolicyDenied", async () => {
  const blocked = {
    payment_id: "pay_0608581ece47",
    decision: "blocked",
    payee: "giftcards.com",
    rule: "Never: gift cards, cash-like, crypto",
    credential: null,
    why: "matched · block",
  };
  mockFetchOnce(403, blocked);
  const client = new PinkClient("pk_sandbox_agent_test");
  await assert.rejects(
    () => client.requestPayment({ amount: 50, payeeName: "giftcards.com", purpose: "prizes" }),
    (err: unknown) => {
      assert.ok(err instanceof PinkPolicyDenied);
      assert.equal(err.payload.decision, "blocked");
      return true;
    },
  );
});

test("unauthorized throws generic PinkError", async () => {
  mockFetchOnce(401, { error: "Unauthorized: send Authorization: Bearer <key>" });
  const client = new PinkClient("pk_sandbox_agent_bad");
  await assert.rejects(
    () => client.getBudget(),
    (err: unknown) => {
      assert.ok(err instanceof PinkError);
      assert.equal(err.statusCode, 401);
      return true;
    },
  );
});

test("listPayees unwraps the payees array", async () => {
  const body = { payees: [{ id: "p_cc", name: "Counter Culture Coffee" }] };
  mockFetchOnce(200, body);
  const client = new PinkClient("pk_sandbox_agent_test");
  const payees = await client.listPayees();
  assert.deepEqual(payees, body.payees);
});

test("createSandboxWorkspace sends no auth header and the right body", async () => {
  const created = {
    workspace_id: "jl43vgtf3j",
    admin_key: "pk_sandbox_admin_jl43vgtf3j_xxxx",
    agents: [{ id: "a_purch", key: "pk_sandbox_agent_jl43vgtf3j_a_purch_xxxx" }],
  };
  mockFetchOnce(201, created);
  const result = await createSandboxWorkspace({ company: "Test Co", template: "coffee" });
  assert.equal(result.workspace_id, "jl43vgtf3j");
  const sentBody = JSON.parse(calls[0].init.body as string);
  assert.deepEqual(sentBody, { template: "coffee", company: "Test Co" });
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
});

test("createSandboxWorkspace non-201 throws PinkError", async () => {
  mockFetchOnce(500, { error: "body must be JSON" });
  await assert.rejects(
    () => createSandboxWorkspace(),
    (err: unknown) => {
      assert.ok(err instanceof PinkError);
      assert.equal(err.statusCode, 500);
      return true;
    },
  );
});

test("mcpConfig returns the streamableHttp shape", () => {
  const config = mcpConfig("pk_sandbox_agent_abc123") as {
    mcpServers: Record<string, { type: string; url: string; headers: Record<string, string> }>;
  };
  const entry = config.mcpServers["pink-agentic-payments-sandbox"];
  assert.equal(entry.type, "streamableHttp");
  assert.equal(entry.url, "https://agentic-sandbox.pinkwallet.com/mcp");
  assert.equal(entry.headers.Authorization, "Bearer pk_sandbox_agent_abc123");
});

test("approvePayment calls the admin approve endpoint with admin key", async () => {
  const approved = {
    payment_id: "pay_dc9a7a2a3c43",
    decision: "approved",
    credential: { type: "bank_transfer", sandbox: true },
    approved_by: ["Sandbox admin"],
  };
  mockFetchOnce(200, approved);
  const result = await approvePayment("pk_sandbox_admin_test", "pay_dc9a7a2a3c43");
  assert.equal(result.decision, "approved");
  assert.equal(
    calls[0].url,
    "https://agentic-sandbox.pinkwallet.com/v1/admin/requests/pay_dc9a7a2a3c43/approve",
  );
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer pk_sandbox_admin_test");
});

test("requestPayment includes idempotencyKey in the request body", async () => {
  mockFetchOnce(201, { payment_id: "pay_x", decision: "allowed", credential: {} });
  const client = new PinkClient("pk_sandbox_agent_test");
  await client.requestPayment({ amount: 10, payeeId: "p_cc", idempotencyKey: "my-key-1" });
  const sentBody = JSON.parse(calls[0].init.body as string);
  assert.equal(sentBody.idempotency_key, "my-key-1");
});

test("PinkClient throws without an agentKey", () => {
  assert.throws(() => new PinkClient(""), /agentKey is required/);
});
