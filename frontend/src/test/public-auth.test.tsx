/** Verify real public form handlers, role destinations and cache/session effects with isolated adapters. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode, ComponentType } from "react";
import { Route as LoginRoute } from "@/routes/login";
import { Route as RegisterRoute } from "@/routes/register";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  error: vi.fn(),
  hydrated: true,
}));
vi.mock("@tanstack/react-router", () => ({
  /** Retain each route's actual component for form-level tests. */
  createFileRoute: () => (options: unknown) => ({ options }),
  /** Observe the destination selected by the actual authentication handler. */
  useNavigate: () => mocks.navigate,
  /** Render ordinary accessible links without booting the complete router. */
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}));
// Test the actual forms and session/cache effects independently of decorative motion.
vi.mock("@/components/marketing/auth-shell", () => ({
  /** Preserve form semantics while excluding purely decorative layout and motion. */
  AuthShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/hooks/use-hydrated", () => ({
  /** Let each test exercise hydrated or server-disabled form controls. */
  useHydrated: () => mocks.hydrated,
}));
vi.mock("sonner", () => ({
  toast: {
    /** Record user-visible error messages without mounting the toast portal. */
    error: (error: unknown) => mocks.error(error),
  },
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  /** Control the credential exchange while preserving the rest of the API module. */
  login: (...args: unknown[]) => mocks.login(...args),
  /** Control registration responses to inspect cache seeding and error handling. */
  register: (...args: unknown[]) => mocks.register(...args),
}));

const Login = LoginRoute.options.component as ComponentType;
const Register = RegisterRoute.options.component as ComponentType;
/** Mount one actual form with an intentionally seeded previous-workspace query cache. */
function show(Component: ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["old-private-data"], "previous workspace");
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.hydrated = true;
});

describe("public authentication preserves the existing workflow", () => {
  it.each([
    ["tenant_admin", "/dashboard"],
    ["support_agent", "/dashboard/inbox"],
    ["super_admin", "/platform"],
  ])("signs in %s and clears previous private queries", async (role, destination) => {
    const account = { id: "user", role, must_change_password: false };
    mocks.login.mockResolvedValue({ user: account });
    const client = show(Login);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email", { exact: true }), "person@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "Example-password-123!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: destination }));
    expect(mocks.login).toHaveBeenCalledWith("person@example.com", "Example-password-123!");
    expect(client.getQueryData(["old-private-data"])).toBeUndefined();
    expect(client.getQueryData(["me"])).toEqual(account);
  });
  it("preserves the mandatory password-change destination", async () => {
    mocks.login.mockResolvedValue({ user: { role: "support_agent", must_change_password: true } });
    show(Login);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email", { exact: true }), "invited@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "Temporary-password!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/change-password" }));
  });
  it("retains login drafts and exposes errors without navigation", async () => {
    mocks.login.mockRejectedValue(new Error("Invalid credentials"));
    show(Login);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email", { exact: true }), "person@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "Wrong-password!");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Invalid credentials"));
    expect(screen.getByLabelText("Email", { exact: true })).toHaveValue("person@example.com");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("registers with the original payload, seeds the account, and opens the dashboard", async () => {
    const account = { id: "new-admin", role: "tenant_admin" };
    mocks.register.mockResolvedValue({ user: account });
    const client = show(Register);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Company name"), "Example workspace");
    await user.type(screen.getByLabelText("Work email"), "admin@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "Example-password-123!");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard" }));
    expect(mocks.register).toHaveBeenCalledWith({
      organization_name: "Example workspace",
      admin_email: "admin@example.com",
      password: "Example-password-123!",
    });
    expect(client.getQueryData(["old-private-data"])).toBeUndefined();
    expect(client.getQueryData(["me"])).toEqual(account);
  });
  it("keeps rejected registration editable and reports its real error", async () => {
    mocks.register.mockRejectedValue(new Error("Email already registered"));
    show(Register);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Company name"), "Example workspace");
    await user.type(screen.getByLabelText("Work email"), "existing@example.com");
    await user.type(screen.getByLabelText("Password", { exact: true }), "Example-password-123!");
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Email already registered"));
    expect(screen.getByLabelText("Company name")).toHaveValue("Example workspace");
    expect(screen.getByRole("button", { name: "Create workspace" })).toBeEnabled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("keeps sign-in disabled until hydration", () => {
    mocks.hydrated = false;
    show(Login);
    expect(screen.getByLabelText("Email", { exact: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});
