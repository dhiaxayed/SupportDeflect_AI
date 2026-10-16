/**
 * @file Playground component regressions with controlled askPlayground responses. Assert
 * accessible input/send controls, local validation, trimmed history, evidence-based
 * diagnostics and distinct greeting/outage rendering without misleading confidence
 * percentages.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatPlayground } from "@/components/chat-playground";

const mocks = vi.hoisted(() => ({ ask: vi.fn() }));
vi.mock("@/lib/api", () => ({ askPlayground: mocks.ask }));
/**
 * Render a fresh Playground inside its own QueryClientProvider so invalidation and local
 * conversation state cannot leak across test cases.
 */
const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChatPlayground />
    </QueryClientProvider>,
  );

describe("Playground answer diagnostics", () => {
  it("labels chat controls and rejects questions shorter than the API minimum", async () => {
    show();
    const user = userEvent.setup();
    const input = screen.getByRole("textbox", { name: "Your question" });
    const send = screen.getByRole("button", { name: "Send message" });
    await user.type(input, "x{enter}");
    expect(send).toBeDisabled();
    expect(mocks.ask).not.toHaveBeenCalled();
    expect(input).toHaveValue("x");
  });

  it("trims the submitted question so surrounding spaces do not enter conversation history", async () => {
    mocks.ask.mockResolvedValue({
      answer: "Hello!",
      confidence: 0,
      resolved: true,
      sources: [],
      reason: "greeting",
    });
    show();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "  hello  {enter}");
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    expect(mocks.ask).toHaveBeenCalledWith("hello", []);
  });

  it("keeps the actual conversation for follow-up questions without a fake confidence percentage", async () => {
    mocks.ask.mockClear();
    mocks.ask.mockResolvedValueOnce({
      answer: "Alex est ingenieur [1].",
      confidence: 0.24,
      resolved: true,
      sources: [{ title: "[1] CV", chunk: "Alex Martin est ingenieur." }],
      reason: "documented_answer",
    });
    mocks.ask.mockResolvedValueOnce({
      answer: "Python et Docker [1].",
      confidence: 0.3,
      resolved: true,
      sources: [{ title: "[1] CV", chunk: "Python et Docker" }],
      reason: "documented_answer",
    });
    show();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "Qui est Alex?{enter}");
    expect(await screen.findByText("Alex est ingenieur [1].")).toBeInTheDocument();
    expect(screen.getByText("Retrieval score 0.24")).toBeInTheDocument();
    await user.type(screen.getByRole("textbox"), "Et ses competences?{enter}");
    expect(await screen.findByText("Python et Docker [1].")).toBeInTheDocument();
    expect(mocks.ask).toHaveBeenLastCalledWith("Et ses competences?", [
      { role: "user", content: "Qui est Alex?" },
      { role: "assistant", content: "Alex est ingenieur [1]." },
    ]);
  });
  it("displays greetings without misleading confidence or empty sources", async () => {
    mocks.ask.mockResolvedValue({
      answer: "Hello!",
      confidence: 0,
      resolved: true,
      sources: [],
      reason: "greeting",
    });
    show();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "helo{enter}");
    expect(await screen.findByText("Hello!")).toBeInTheDocument();
    expect(screen.getByText("Conversation")).toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("distinguishes a Groq rate limit from inadequate documentation", async () => {
    mocks.ask.mockResolvedValue({
      answer: "Please retry shortly.",
      confidence: 0,
      resolved: false,
      sources: [],
      reason: "llm_unavailable",
      errorCode: "rate_limit",
    });
    show();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox"), "hello{enter}");
    expect(await screen.findByText("AI unavailable")).toBeInTheDocument();
    expect(screen.getByText("Groq rate limit reached")).toBeInTheDocument();
    expect(screen.queryByText(/Confidence/)).not.toBeInTheDocument();
  });
});
