/**
 * @file Password-replacement component contracts with controlled account and authentication
 * outcomes. Distinguish a rejected change from a successful mutation followed by failed
 * reauthentication, and verify mandatory invited-user transitions without storing real
 * credentials.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route } from "@/routes/change-password";
import { SessionChangedError } from "@/lib/api";

/** Mount the registered password workflow without adding a production export solely for tests. */
const ChangePassword = Route.options.component as React.ComponentType;

const mocks = vi.hoisted(() => ({
  account: {
    data: { email: "agent@example.com", must_change_password: true },
    isError: false,
    error: null as Error | null,
  },
  navigate: vi.fn(),
  change: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  clearSession: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  /**
   * Retain the route options so tests mount the actual password component without requiring
   * the generated application tree.
   */
  createFileRoute: () => (config: unknown) => ({ options: config }),
  /**
   * Capture the post-change role-home or sign-in destination selected by the real component.
   */
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/hooks/use-auth", () => ({
  /**
   * Expose the per-test account/loading/error fixture to the password workflow without making
   * an unrelated account request.
   */
  useCurrentUser: () => mocks.account,
  /**
   * Keep these focused tests authenticated so assertions target password lifecycle rather than
   * the separate anonymous-route guard.
   */
  useRequireAuth: () => true,
  /**
   * Capture the explicit return-to-sign-in action on account-error screens.
   */
  useLogout: () => mocks.logout,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  /**
   * Control the password-mutation result independently of the following login result, making
   * partial success observable.
   */
  apiRequest: (...args: unknown[]) => mocks.change(...args),
  /**
   * Capture replacement-credential reauthentication and allow tests to fail it after a
   * successful password mutation.
   */
  login: (...args: unknown[]) => mocks.login(...args),
  /**
   * Observe cleanup of the obsolete session after reauthentication failure without altering
   * unrelated API exports.
   */
  logout: () => mocks.clearSession(),
}));

/**
 * Mount the actual route component under a fresh query client so account-cache changes can run
 * without another test's state.
 */
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChangePassword />
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.account.isError = false;
  mocks.account.error = null;
});

describe("invitation password activation", () => {
  it("preserves a newer account if password reauthentication is superseded", async () => {
    mocks.change.mockResolvedValue(undefined);
    mocks.login.mockRejectedValue(new SessionChangedError());
    show();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Current password", { exact: true }),
      "Temporary-fixture-password!",
    );
    await user.type(
      screen.getByLabelText("New password", { exact: true }),
      "Personal-fixture-password!",
    );
    await user.type(
      screen.getByLabelText("Confirm new password", { exact: true }),
      "Personal-fixture-password!",
    );
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledOnce());
    expect(mocks.clearSession).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it("exposes expired account errors instead of waiting forever", async () => {
    mocks.account.isError = true;
    mocks.account.error = new Error(
      "Invitation expired. Ask your administrator for a new invitation.",
    );
    show();
    expect(screen.getByRole("alert")).toHaveTextContent("Invitation expired");
    expect(screen.queryByText("Loading account...")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(mocks.logout).toHaveBeenCalledOnce();
  });

  it("does not repeat a successful password change if automatic login fails", async () => {
    mocks.change.mockResolvedValue(undefined);
    mocks.login.mockRejectedValue(new Error("Connection interrupted"));
    show();
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("Current password", { exact: true }),
      "Temporary-fixture-password!",
    );
    await user.type(
      screen.getByLabelText("New password", { exact: true }),
      "Personal-fixture-password!",
    );
    await user.type(
      screen.getByLabelText("Confirm new password", { exact: true }),
      "Personal-fixture-password!",
    );
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/login" }));
    expect(mocks.change).toHaveBeenCalledOnce();
    expect(mocks.clearSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
