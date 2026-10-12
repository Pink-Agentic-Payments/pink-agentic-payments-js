/**
 * JavaScript/TypeScript client for the Pink Agentic AI Payments sandbox REST
 * API. Every method here maps 1:1 to an operation documented in the
 * sandbox's OpenAPI spec (https://github.com/Pink-Agentic-Payments/sandbox-examples,
 * openapi/openapi.yaml). See NOTES.md in this package's repo root for the
 * endpoint-by-method mapping.
 *
 * Sandbox only: test credentials, no real money moves, production is not
 * yet available for this product.
 */
import { PinkError, PinkApprovalPending, PinkPolicyDenied } from "./errors.js";

export const DEFAULT_BASE_URL = "https://agentic-sandbox.pinkwallet.com";

// Cloudflare (fronting the sandbox) blocks the default fetch/Node user
// agent string outright, so every request needs an explicit one. Confirmed
// by the Python reference client's NOTES.md and reproduced against the
// live sandbox while building this client.
const USER_AGENT = "pink-agentic-payments-js/0.1.0";

export type JsonRecord = Record<string, unknown>;

export interface PaymentInput {
  amount: number;
  payeeId?: string;
  payeeName?: string;
  currency?: string;
  purpose?: string;
  reason?: string;
  evidence?: string[];
  evidenceFlags?: string[];
  localHour?: number;
}

export interface RequestPaymentInput extends PaymentInput {
  idempotencyKey?: string;
}

export interface SandboxWorkspace {
  workspace_id: string;
  admin_key: string;
  agents: Array<{ id: string; key: string; name: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

async function request(
  method: string,
  url: string,
  options: {
    bearerToken?: string;
    body?: JsonRecord;
    timeoutMs?: number;
  } = {},
): Promise<{ status: number; payload: JsonRecord }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
  };
  if (options.bearerToken) {
    headers.Authorization = `Bearer ${options.bearerToken}`;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const raw = await res.text();
    let payload: JsonRecord = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { error: raw };
      }
    }
    return { status: res.status, payload };
  } finally {
    clearTimeout(timeout);
  }
}

function paymentBody(input: PaymentInput): JsonRecord {
  const body: JsonRecord = {
    amount: input.amount,
    currency: input.currency ?? "USD",
  };
  if (input.payeeId !== undefined) body.payee_id = input.payeeId;
  if (input.payeeName !== undefined) body.payee_name = input.payeeName;
  if (input.purpose !== undefined) body.purpose = input.purpose;
  if (input.reason !== undefined) body.reason = input.reason;
  if (input.evidence !== undefined) body.evidence = input.evidence;
  if (input.evidenceFlags !== undefined) body.evidence_flags = input.evidenceFlags;
  if (input.localHour !== undefined) body.local_hour = input.localHour;
  return body;
}

function raiseForDecision(status: number, payload: JsonRecord): JsonRecord {
  const decision = payload.decision as string | undefined;
  if (status === 403 || decision === "blocked" || decision === "declined") {
    throw new PinkPolicyDenied(payload);
  }
  if (status === 202 || decision === "pending_human") {
    throw new PinkApprovalPending(payload);
  }
  if (status >= 400) {
    throw new PinkError(status, (payload.error as string) || "sandbox API error", payload);
  }
  return payload;
}

/**
 * Create a free, disposable sandbox workspace. No auth required.
 *
 * Maps to POST /v1/sandbox/workspaces (the sandbox's signup flow).
 * `template` is one of "coffee" (default), "startup" or "ecommerce";
 * unknown values fall back to "coffee". Returns the admin key and one
 * agent key per seeded agent, each shown once. These are sandbox-only test
 * credentials (pk_sandbox_admin_... / pk_sandbox_agent_...); no real money
 * is ever involved.
 */
export async function createSandboxWorkspace(
  options: { company?: string; email?: string; template?: string; baseUrl?: string } = {},
): Promise<SandboxWorkspace> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const body: JsonRecord = { template: options.template ?? "coffee" };
  if (options.company !== undefined) body.company = options.company;
  if (options.email !== undefined) body.email = options.email;
  const { status, payload } = await request("POST", `${baseUrl}/v1/sandbox/workspaces`, { body });
  if (status !== 201) {
    throw new PinkError(status, (payload.error as string) || "failed to create sandbox workspace", payload);
  }
  return payload as unknown as SandboxWorkspace;
}

/**
 * POST /v1/admin/requests/{id}/approve: approve a pending_human hold.
 *
 * Needs the workspace's admin key (pk_sandbox_admin_...), not an agent key;
 * this is the operation a human takes in /console to turn a pending_human
 * hold into an issued credential. `by` is an optional approver display
 * name (defaults to "Sandbox admin" server-side).
 */
export async function approvePayment(
  adminKey: string,
  paymentId: string,
  options: { by?: string; baseUrl?: string } = {},
): Promise<JsonRecord> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const body: JsonRecord = options.by ? { by: options.by } : {};
  const { status, payload } = await request(
    "POST",
    `${baseUrl}/v1/admin/requests/${paymentId}/approve`,
    { bearerToken: adminKey, body },
  );
  if (status >= 400) {
    throw new PinkError(status, (payload.error as string) || "failed to approve payment", payload);
  }
  return payload;
}

/**
 * POST /v1/admin/requests/{id}/decline: decline a pending_human hold.
 *
 * Needs the workspace's admin key, not an agent key. See approvePayment.
 */
export async function declinePayment(
  adminKey: string,
  paymentId: string,
  options: { by?: string; baseUrl?: string } = {},
): Promise<JsonRecord> {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
  const body: JsonRecord = options.by ? { by: options.by } : {};
  const { status, payload } = await request(
    "POST",
    `${baseUrl}/v1/admin/requests/${paymentId}/decline`,
    { bearerToken: adminKey, body },
  );
  if (status >= 400) {
    throw new PinkError(status, (payload.error as string) || "failed to decline payment", payload);
  }
  return payload;
}

/**
 * Return a ready-to-paste remote MCP client config object.
 *
 * This is the same mcpServers / Streamable HTTP shape documented for Cline
 * (https://docs.cline.bot/mcp/configuring-mcp-servers) in this product's
 * sandbox-examples repo (llms-install.md), which Claude Desktop and Cursor
 * also use for remote MCP servers over HTTP: a type: streamableHttp entry
 * with the sandbox's /mcp URL and an Authorization: Bearer <agent_key>
 * header.
 */
export function mcpConfig(agentKey: string, baseUrl: string = DEFAULT_BASE_URL): JsonRecord {
  return {
    mcpServers: {
      "pink-agentic-payments-sandbox": {
        type: "streamableHttp",
        url: `${baseUrl}/mcp`,
        headers: { Authorization: `Bearer ${agentKey}` },
        disabled: false,
        autoApprove: [],
      },
    },
  };
}

/**
 * Agent-side client for the Pink Agentic AI Payments sandbox.
 *
 * Every method below calls exactly one documented endpoint of the sandbox
 * REST API under {baseUrl}/v1 using the agent's bearer key. See NOTES.md
 * for the full endpoint mapping (including the two admin-only endpoints
 * exposed as plain functions, not on this class, since they need a
 * different key type).
 */
export class PinkClient {
  agentKey: string;
  baseUrl: string;
  timeoutMs: number;

  constructor(agentKey: string, options: { baseUrl?: string; timeoutMs?: number } = {}) {
    if (!agentKey) {
      throw new Error("agentKey is required (looks like pk_sandbox_agent_...)");
    }
    this.agentKey = agentKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async call(method: string, path: string, body?: JsonRecord): Promise<JsonRecord> {
    const { status, payload } = await request(method, `${this.baseUrl}/v1${path}`, {
      bearerToken: this.agentKey,
      body,
      timeoutMs: this.timeoutMs,
    });
    if (status >= 400) {
      throw new PinkError(status, (payload.error as string) || "sandbox API error", payload);
    }
    return payload;
  }

  /** GET /v1/me: this agent's identity and the workspace summary. */
  async getIdentity(): Promise<JsonRecord> {
    return this.call("GET", "/me");
  }

  /** GET /v1/budget: this agent's budget, spend-to-date and vault balance. */
  async getBudget(): Promise<JsonRecord> {
    return this.call("GET", "/budget");
  }

  /** GET /v1/payees: payees visible to this agent. */
  async listPayees(): Promise<JsonRecord[]> {
    const payload = await this.call("GET", "/payees");
    return payload.payees as JsonRecord[];
  }

  /** GET /v1/vaults: vault(s) this agent can spend from. */
  async listVaults(): Promise<JsonRecord[]> {
    const payload = await this.call("GET", "/vaults");
    return payload.vaults as JsonRecord[];
  }

  /** GET /v1/rules: the policy rules that apply to this agent. */
  async listRules(): Promise<JsonRecord[]> {
    const payload = await this.call("GET", "/rules");
    return payload.rules as JsonRecord[];
  }

  /**
   * POST /v1/payments/check: dry-run a payment against policy.
   *
   * No spend, no side effects. Returns a decision prefixed `would_`
   * (would_allow / would_ask / would_block) plus the matched rule and a
   * human-readable `trace` of every rule the engine checked.
   */
  async checkPolicy(input: PaymentInput): Promise<JsonRecord> {
    return this.call("POST", "/payments/check", paymentBody(input));
  }

  /**
   * POST /v1/payments: request a real sandbox payment.
   *
   * Returns the PaymentResult with a one-time credential when the policy
   * engine decision is `allowed` (HTTP 201).
   *
   * Throws PinkApprovalPending when the decision is `pending_human`
   * (HTTP 202; poll with getCredential), and PinkPolicyDenied when the
   * decision is `blocked` (HTTP 403; this exact request will never be
   * allowed). Both errors carry the full response as `.payload`.
   *
   * Pass `idempotencyKey` to safely retry: replaying the same key for this
   * agent returns the original decision unchanged, with `replayed: true`,
   * at the same HTTP status as the first call.
   */
  async requestPayment(input: RequestPaymentInput): Promise<JsonRecord> {
    const body = paymentBody(input);
    if (input.idempotencyKey !== undefined) body.idempotency_key = input.idempotencyKey;
    const { status, payload } = await request("POST", `${this.baseUrl}/v1/payments`, {
      bearerToken: this.agentKey,
      body,
      timeoutMs: this.timeoutMs,
    });
    return raiseForDecision(status, payload);
  }

  /**
   * GET /v1/payments/{id}: look up a payment/hold by id.
   *
   * Returns the current PaymentResult regardless of decision (does not
   * throw), so callers can poll a pending_human hold without exception
   * handling. Use getCredential if you want the throwing version that
   * matches the pink.get_credential MCP tool.
   */
  async getPayment(paymentId: string): Promise<JsonRecord> {
    return this.call("GET", `/payments/${paymentId}`);
  }

  /**
   * Poll a payment/hold and return its credential once decided.
   *
   * This is the REST equivalent of the pink.get_credential MCP tool: under
   * the hood it is just GET /v1/payments/{id} (there is no separate
   * "credential" endpoint in the sandbox). Throws PinkApprovalPending while
   * still pending_human, and PinkPolicyDenied if it was declined/blocked.
   */
  async getCredential(paymentId: string): Promise<JsonRecord> {
    const payload = await this.getPayment(paymentId);
    return raiseForDecision(200, payload);
  }

  /**
   * POST /v1/payments/{id}/receipt: attach a receipt to a payment.
   *
   * Raises the agent's trust score. `receipt` is a free-form object, e.g.
   * { merchant: "...", total: 420, reference: "INV-1" }.
   */
  async reportReceipt(paymentId: string, receipt: JsonRecord): Promise<JsonRecord> {
    return this.call("POST", `/payments/${paymentId}/receipt`, { receipt });
  }
}
