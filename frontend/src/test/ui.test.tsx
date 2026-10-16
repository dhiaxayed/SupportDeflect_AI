/**
 * @file Shared tenant/platform UI contracts under deterministic account, membership,
 * subscription and BI fixtures. Assert real role guards, case actions, member
 * creation/invitation labels, organization commercial edits and API-derived metrics while
 * replacing only navigation/network/chart-measurement boundaries.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleGuard } from "@/components/role-guard";
import { CaseDetail } from "@/routes/dashboard.inbox";
import { Billing } from "@/components/subscription-usage";
import { Team } from "@/components/team-management";
import { OrganizationDetail } from "@/routes/platform.organizations.$id";
import { PlatformOverview } from "@/components/platform-overview";
import type { SupportCase, PlatformOrg } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  current: { role: "tenant_admin", organization: { name: "Acme" }, must_change_password: false },
  update: vi.fn(),
  createMember: vi.fn(),
  team: vi.fn(async () => [] as import("@/lib/api").TeamUser[]),
  updateOrganization: vi.fn(),
  usage: {
    plan_label: "Starter",
    status: "active",
    questions_used_30d: 12,
    questions_limit_30d: 2000,
    documents_used: 2,
    documents_limit: 25,
    chunks_used: 15,
    chunks_limit: 2000,
    max_upload_bytes: 10485760,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  /**
   * Capture role/password redirections so guard behavior is observable without a live router
   * history.
   */
  useNavigate: () => mocks.navigate,
  /**
   * Return route configuration directly so exported feature components can be tested without
   * the generated route tree.
   */
  createFileRoute: () => (config: unknown) => config,
  /**
   * Preserve link children in focused rendering tests while excluding router-provider
   * requirements unrelated to the asserted form action.
   */
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));
vi.mock("recharts", async (original) => ({
  ...(await original<typeof import("recharts")>()),
  /**
   * Replace layout measurement with a labeled chart placeholder because jsdom has no real
   * viewport; business values remain tested separately.
   */
  ResponsiveContainer: () => <div aria-label="Chart" />,
}));
vi.mock("@/lib/admin-api", async (original) => ({
  ...(await original<typeof import("@/lib/admin-api")>()),
  /**
   * Return explicit zero-baseline BI plus known counts so the view must render backend-shaped
   * metrics rather than placeholder data.
   */
  getBusiness: async () => ({
    days: 30,
    currency: "EUR",
    channel: "widget",
    generated_at: "2026-09-26T12:00:00Z",
    start: "2026-08-27",
    end: "2026-09-26",
    organizations_total: 7,
    open_cases: 3,
    documents_total: 10,
    mrr_minor: 0,
    arr_minor: 0,
    unpriced_organizations: 0,
    metrics: Object.fromEntries(
      ["questions", "resolved", "resolution_rate", "revenue_minor", "new_organizations"].map(
        (key) => [key, { value: 0, previous: 0, delta: 0, delta_percent: null }],
      ),
    ),
    plan_distribution: [{ name: "trial", value: 7 }],
    series: [],
    risks: [],
    risks_total: 0,
    top_organizations: [],
  }),
}));
vi.mock("@/hooks/use-auth", () => ({
  /**
   * Hold authentication present while each test varies the current role or required-password
   * state under RoleGuard.
   */
  useRequireAuth: () => true,
  /**
   * Return the mutable per-test account fixture so permission and invitation gates can be
   * exercised deterministically.
   */
  useCurrentUser: () => ({ data: mocks.current }),
}));
vi.mock("@/hooks/use-data", () => ({
  /**
   * Supply fixed plan entitlements/counters so the real subscription view can render usage
   * without a backend.
   */
  useSubscriptionUsage: () => ({ data: mocks.usage, isPending: false, error: null }),
}));
vi.mock("@/components/dashboard-header", () => ({
  /**
   * Render the requested feature title while excluding account-menu queries from focused
   * component assertions.
   */
  DashboardHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  /**
   * Return the configured membership fixture used by both Team and Inbox assignment controls.
   */
  getTeam: () => mocks.team(),
  /**
   * Represent ready local capture so invitation wording can be checked independently of SMTP
   * process availability.
   */
  getTeamMailStatus: async () => ({ connected: true, smtp_ready: true, detail: "local_capture" }),
  /**
   * Capture real Inbox action payloads and return test-selected responses for
   * note/resolution/status assertions.
   */
  updateCase: (...args: unknown[]) => mocks.update(...args),
  /**
   * Capture the chosen name/email/tenant role submitted by the real invitation form.
   */
  createTeamUser: (...args: unknown[]) => mocks.createMember(...args),
  /**
   * Capture selected organization plan/status fields submitted by the real commercial editor.
   */
  updatePlatformOrg: (...args: unknown[]) => mocks.updateOrganization(...args),
  /**
   * Provide known operational totals to check that platform cards consume response data rather
   * than inventing values.
   */
  getPlatformOverview: async () => ({ organizations_total: 7, open_support_cases: 3 }),
}));
/**
 * Mount a feature under a fresh no-retry query client so one failing fixture cannot trigger
 * background retries or pollute another assertion.
 */
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
describe("role-aware views", () => {
  it("denies the platform area to a tenant admin", async () => {
    mocks.current.role = "tenant_admin";
    render(
      <RoleGuard roles={["super_admin"]}>
        <span>Platform secret</span>
      </RoleGuard>,
    );
    expect(screen.queryByText("Platform secret")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
  });
  it("denies tenant pages to a platform admin", async () => {
    mocks.current.role = "super_admin";
    render(
      <RoleGuard roles={["tenant_admin"]}>
        <span>Tenant documents</span>
      </RoleGuard>,
    );
    expect(screen.queryByText("Tenant documents")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/platform" }));
  });
  it("allows support agents into the inbox", () => {
    mocks.current.role = "support_agent";
    render(
      <RoleGuard roles={["tenant_admin", "support_agent"]}>
        <span>Inbox content</span>
      </RoleGuard>,
    );
    expect(screen.getByText("Inbox content")).toBeInTheDocument();
  });
  it("displays subscription data from the backend", () => {
    wrap(<Billing />);
    expect(screen.getByLabelText("Current subscription plan")).toHaveTextContent("Starter");
    expect(screen.getByText(/12 \/ 2[\s,]000/)).toBeInTheDocument();
    expect(screen.queryByText("Pro plan")).not.toBeInTheDocument();
  });
  it("assigns, saves notes and resolves a support case", async () => {
    mocks.update.mockResolvedValue({});
    const item = {
      id: "case-1",
      status: "open",
      question: "Question",
      ai_answer: "Cannot confirm",
      created_at: "2026-09-01T00:00:00Z",
      visitor_id: "visitor",
      confidence_score: 0.1,
      sources: [],
      human_answer: null,
      internal_note: null,
      assigned_to_user_id: null,
    } as unknown as SupportCase;
    wrap(<CaseDetail item={item} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Assign to me" }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith("case-1", "assign", {}));
    await user.type(screen.getByLabelText("Internal note"), "Investigated");
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("case-1", "note", {
        internal_note: "Investigated",
      }),
    );
    await user.type(screen.getByLabelText("Human answer"), "The documented resolution");
    await user.click(screen.getByRole("button", { name: "Resolve case" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("case-1", "resolve", {
        human_answer: "The documented resolution",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Close case" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("case-1", "status", { status: "closed" }),
    );
  });
  it("creates a tenant team member using the selected role", async () => {
    mocks.createMember.mockResolvedValue({});
    wrap(<Team />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Full name"), "Alex Agent");
    await user.type(screen.getByLabelText("Email"), "alex@example.com");
    await user.click(screen.getByRole("button", { name: "Invite member" }));
    await waitFor(() =>
      expect(mocks.createMember).toHaveBeenCalledWith({
        email: "alex@example.com",
        full_name: "Alex Agent",
        role: "support_agent",
      }),
    );
    expect(screen.queryByRole("option", { name: "Super admin" })).not.toBeInTheDocument();
  });
  it("updates the actual organization plan and status", async () => {
    mocks.updateOrganization.mockResolvedValue({});
    wrap(
      <OrganizationDetail
        org={
          {
            id: "org-1",
            name: "Acme",
            public_id: "company_acme",
            created_at: "2026-09-01",
            subscription_plan: "trial",
            subscription_status: "trialing",
          } as PlatformOrg
        }
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Subscription" }));
    await user.selectOptions(screen.getByLabelText("Plan"), "pro");
    await user.selectOptions(screen.getByLabelText("Status"), "active");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(mocks.updateOrganization).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          subscription_plan: "pro",
          subscription_status: "active",
        }),
      ),
    );
  });
  it("distinguishes local capture, expired invitations and in-flight delivery", async () => {
    const base = {
      id: "agent",
      email: "agent@example.com",
      full_name: "Invited Agent",
      role: "support_agent" as const,
      is_active: true,
      must_change_password: true,
      created_at: "2026-10-08",
    };
    mocks.team.mockResolvedValueOnce([
      {
        ...base,
        invitation_state: "expired",
        invitation_delivery: {
          id: "mail",
          status: "sent",
          mode: "local_capture",
          attempts: 1,
          error_code: null,
          sent_at: "2026-10-08",
          created_at: "2026-10-08",
        },
      },
      {
        ...base,
        id: "sending-agent",
        email: "sending@example.com",
        invitation_state: "pending",
        invitation_delivery: {
          id: "sending-mail",
          status: "sending",
          mode: "smtp",
          attempts: 1,
          error_code: null,
          sent_at: null,
          created_at: "2026-10-08",
        },
      },
    ]);
    wrap(<Team />);
    expect(await screen.findByText("Invitation expired")).toBeInTheDocument();
    expect(screen.getByText("Captured locally")).toBeInTheDocument();
    expect(
      screen.getByText("Local email capture only. External delivery is disabled."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resend invitation to sending@example.com" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Resend invitation to agent@example.com" }),
    ).toBeEnabled();
  });
  it("renders platform counts returned by the API", async () => {
    wrap(<PlatformOverview usage />);
    expect((await screen.findAllByText("7")).length).toBeGreaterThan(0);
    expect(screen.getByText("Open support cases")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
  it("requires invited users to change their initial password before entering the workspace", async () => {
    mocks.current.role = "support_agent";
    mocks.current.must_change_password = true;
    render(
      <RoleGuard roles={["support_agent"]}>
        <span>Private workspace</span>
      </RoleGuard>,
    );
    expect(screen.queryByText("Private workspace")).not.toBeInTheDocument();
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/change-password" }));
    mocks.current.must_change_password = false;
  });
});
