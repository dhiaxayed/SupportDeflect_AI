/**
 * @file Component regressions for state that crosses asynchronous UI updates: polled Inbox
 * drafts, eligible assignees, cleared private notes, partial upload retry and repeated file
 * selection. Keep rendering/query behavior real while controlling only API results and
 * navigation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CaseDetail } from "@/routes/dashboard.inbox";
import { UploadZone } from "@/components/upload-zone";
import type { SupportCase } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  update: vi.fn(),
  team: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  /**
   * Capture navigation requests so upload success can be asserted without mounting a second
   * router/application.
   */
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  /**
   * Delegate multipart acceptance/failure timing to the per-test spy while preserving the rest
   * of the shared API module.
   */
  uploadDocument: (...args: unknown[]) => mocks.upload(...args),
  /**
   * Capture the exact case action/payload emitted by the real detail form and return the
   * test-selected authoritative record.
   */
  updateCase: (...args: unknown[]) => mocks.update(...args),
  /**
   * Supply controlled accepted/pending team members to exercise assignment eligibility without
   * an external account API.
   */
  getTeam: () => mocks.team(),
}));

const item: SupportCase = {
  id: "case",
  org_id: "org",
  conversation_id: "conversation",
  status: "open",
  question: "Help?",
  ai_answer: "Contact support",
  sources: [],
  confidence_score: 0.1,
  channel: "widget",
  visitor_id: "visitor",
  internal_note: "Saved note",
  human_answer: null,
  assigned_to_user_id: "agent",
  assignee: null,
  reason: "insufficient_knowledge",
  resolved_at: null,
  created_at: "2026-10-08T12:00:00Z",
  updated_at: "2026-10-08T12:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.team.mockResolvedValue([
    { id: "agent", email: "accepted@example.com", is_active: true, must_change_password: false },
    { id: "pending", email: "pending@example.com", is_active: true, must_change_password: true },
  ]);
});

describe("product workflow consistency", () => {
  it("allows a removed file to be selected again", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UploadZone />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const input = screen.getByLabelText("Upload knowledge files");
    const file = new File(["Guide"], "guide.txt", { type: "text/plain" });
    await user.upload(input, file);
    await user.click(screen.getByRole("button", { name: "Remove guide.txt" }));
    expect(screen.queryByText("guide.txt")).not.toBeInTheDocument();
    await user.upload(input, file);
    expect(screen.getByText("guide.txt")).toBeInTheDocument();
  });

  it("preserves drafts when a polled case changes, excludes pending agents and supports unassignment", async () => {
    const client = new QueryClient();
    const view = render(
      <QueryClientProvider client={client}>
        <CaseDetail item={item} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    expect(await screen.findByRole("option", { name: "accepted@example.com" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "pending@example.com" })).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Internal note"));
    await user.type(screen.getByLabelText("Internal note"), "Unsaved draft");
    await user.type(screen.getByLabelText("Human answer"), "My answer");
    view.rerender(
      <QueryClientProvider client={client}>
        <CaseDetail
          item={{ ...item, internal_note: "Colleague note", updated_at: "2026-10-08T12:01:00Z" }}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Internal note")).toHaveValue("Unsaved draft");
    expect(screen.getByLabelText("Human answer")).toHaveValue("My answer");
    mocks.update.mockResolvedValue({ ...item, assigned_to_user_id: null });
    await user.selectOptions(screen.getByLabelText("Assignee"), "");
    await user.click(screen.getByRole("button", { name: "Unassign" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("case", "assign", { assigned_to_user_id: null }),
    );
  });

  it("lets an existing internal note be cleared", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CaseDetail item={item} />
      </QueryClientProvider>,
    );
    mocks.update.mockResolvedValue({ ...item, internal_note: null });
    const user = userEvent.setup();
    await user.clear(screen.getByLabelText("Internal note"));
    await user.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith("case", "note", { internal_note: "" }),
    );
  });

  it("does not re-upload files already accepted before a partial batch failure", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <UploadZone />
      </QueryClientProvider>,
    );
    const first = new File(["First guide"], "first.txt", { type: "text/plain" });
    const second = new File(["Second guide"], "second.txt", { type: "text/plain" });
    mocks.upload
      .mockResolvedValueOnce({ id: "first", status: "pending" })
      .mockRejectedValueOnce(new Error("Network interrupted"))
      .mockResolvedValueOnce({ id: "second", status: "pending" });
    const user = userEvent.setup();
    await user.upload(screen.getByLabelText("Upload knowledge files"), [first, second]);
    await user.click(screen.getByRole("button", { name: "Start indexing" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start indexing" })).toBeEnabled(),
    );
    expect(screen.queryByText("first.txt")).not.toBeInTheDocument();
    expect(screen.getByText("second.txt")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start indexing" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(3));
    expect(mocks.upload.mock.calls.map((args) => args[0].name)).toEqual([
      "first.txt",
      "second.txt",
      "second.txt",
    ]);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/dashboard/documents" });
  });
});
