/**
 * @file Tenant/support-agent Inbox for asynchronous human follow-up. Poll cases by lifecycle
 * state, select a case and keep private-note/answer/assignee drafts local. Explicit API
 * actions enforce transitions; human resolution never rewrites the original AI response or its
 * reporting outcome.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Save, UserCheck, Play, Archive, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { getCases, getTeam, updateCase, type SupportCase } from "@/lib/api";

export const Route = createFileRoute("/dashboard/inbox")({ component: Inbox });
const statuses = {
  open: "Open",
  in_review: "In review",
  resolved: "Resolved",
  closed: "Closed",
} as const;

/**
 * Render the selected lifecycle queue and case detail, polling every fifteen seconds and
 * resetting selection when the user changes status tabs.
 */
function Inbox() {
  const [status, setStatus] = useState<SupportCase["status"]>("open");
  const [selected, setSelected] = useState<string | null>(null);
  const cases = useQuery({
    queryKey: ["cases", status],
    /**
     * Read the exact queue state represented by the cases cache key so open, reviewed,
     * resolved and closed lists remain separate.
     */
    queryFn: () => getCases(status),
    refetchInterval: 15000,
  });
  const selectedCase = cases.data?.find((c) => c.id === selected) ?? cases.data?.[0];
  return (
    <>
      <DashboardHeader
        title="Support Inbox"
        description="Review questions, collaborate with your team and send a human response."
      />
      <div className="p-4 md:p-6">
        <div
          role="tablist"
          aria-label="Case status"
          className="flex w-fit max-w-full gap-1 rounded-lg bg-muted p-1 mb-5 overflow-x-auto"
        >
          {Object.entries(statuses).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={status === value}
              className={`rounded-md px-4 py-2 text-sm whitespace-nowrap font-medium transition-colors ${status === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => {
                setStatus(value as SupportCase["status"]);
                setSelected(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <QueryState pending={cases.isPending} error={cases.error} />
        {cases.data?.length === 0 && (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            No {statuses[status].toLowerCase()} cases.
          </Card>
        )}
        <div className="grid gap-6 xl:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
          <ul
            className={
              cases.data?.length
                ? "self-start overflow-hidden rounded-xl border bg-card shadow divide-y"
                : ""
            }
          >
            {cases.data?.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setSelected(c.id)}
                  className={`w-full text-left py-5 px-5 text-sm transition-colors ${selectedCase?.id === c.id ? "bg-primary/5 border-l-2 border-primary" : "hover:bg-muted/50 border-l-2 border-transparent"}`}
                >
                  <span className="block font-medium break-words">{c.question}</span>
                  <span className="block mt-2 break-all text-xs text-muted-foreground">
                    {c.visitor_id || (c.channel === "admin" ? "Playground" : "Visitor")} &middot;{" "}
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selectedCase && <CaseDetail key={selectedCase.id} item={selectedCase} />}
        </div>
      </div>
    </>
  );
}

/**
 * Display immutable question/AI evidence beside mutable assignment, internal note and
 * human-answer fields; local drafts survive background updates to the same case.
 */
export function CaseDetail({ item }: { item: SupportCase }) {
  const cache = useQueryClient();
  const team = useQuery({ queryKey: ["team"], queryFn: getTeam });
  // Polling can update the same case while a colleague types; preserve unsaved local drafts.
  const [noteDraft, setNote] = useState<string | null>(null);
  const [answerDraft, setAnswer] = useState<string | null>(null);
  const [assigneeDraft, setAssignee] = useState<string | null>(null);
  const note = noteDraft ?? item.internal_note ?? "";
  const answer = answerDraft ?? item.human_answer ?? "";
  const assignee = assigneeDraft ?? item.assigned_to_user_id ?? "";
  const mutation = useMutation({
    /**
     * Send one named case action and payload for this selected case; backend validation
     * decides allowed transitions and assignees.
     */
    mutationFn: ({
      action,
      payload,
    }: {
      action: "assign" | "note" | "resolve" | "status";
      payload: Record<string, unknown>;
    }) => updateCase(item.id, action, payload),
    /**
     * Replace matching case records in existing queue caches, clear only the saved draft field
     * and refetch queues so changed statuses move to their proper lists.
     */
    onSuccess: (updated, variables) => {
      cache.setQueriesData<SupportCase[]>({ queryKey: ["cases"] }, (items) =>
        items?.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      if (variables.action === "note") setNote(null);
      if (variables.action === "resolve") setAnswer(null);
      if (variables.action === "assign") setAssignee(null);
      void cache.invalidateQueries({ queryKey: ["cases"] });
      toast.success("Case updated");
    },
    /**
     * Display a rejected case action while leaving unsaved note/answer/assignment drafts
     * available for correction.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  /**
   * Dispatch an explicit case action through the shared mutation instead of issuing
   * independent requests from each control.
   */
  const act = (
    action: "assign" | "note" | "resolve" | "status",
    payload: Record<string, unknown>,
  ) => mutation.mutate({ action, payload });
  return (
    <section className="min-w-0 space-y-5 rounded-xl border bg-card p-6 shadow">
      <div>
        <h2 className="text-lg font-semibold break-words">{item.question}</h2>
        <p className="text-xs text-muted-foreground mt-2 break-all">
          {item.visitor_id || (item.channel === "admin" ? "Playground" : "Visitor")} &middot;{" "}
          {new Date(item.created_at).toLocaleString()}
        </p>
      </div>
      <div className="border-l-2 border-warning pl-4">
        <h3 className="text-sm font-semibold">AI response</h3>
        <p className="whitespace-pre-wrap break-words text-sm mt-2">{item.ai_answer}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Retrieval score {item.confidence_score.toFixed(2)} &middot; {statuses[item.status]}
        </p>
      </div>
      {item.sources.length > 0 && (
        <details>
          <summary className="text-sm cursor-pointer">Evidence ({item.sources.length})</summary>
          {item.sources.map((s, i) => (
            <div key={i} className="py-3 text-sm break-words">
              <strong>{s.title}</strong>
              <p>{s.snippet}</p>
            </div>
          ))}
        </details>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm flex-1 min-w-40">
          Assignee
          <select
            aria-label="Assignee"
            className="field-select mt-2"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
          >
            <option value="">Unassigned</option>
            {team.data
              ?.filter((u) => u.is_active && !u.must_change_password)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
          </select>
        </label>
        <Button
          disabled={mutation.isPending || assignee === (item.assigned_to_user_id ?? "")}
          variant="outline"
          onClick={() => act("assign", { assigned_to_user_id: assignee || null })}
        >
          <UserCheck className="mr-2 size-4" />
          {assignee ? "Assign" : "Unassign"}
        </Button>
        <Button disabled={mutation.isPending} variant="outline" onClick={() => act("assign", {})}>
          Assign to me
        </Button>
        {item.status === "open" && (
          <Button
            disabled={mutation.isPending}
            variant="outline"
            onClick={() => act("status", { status: "in_review" })}
          >
            <Play className="mr-2 size-4" />
            Start review
          </Button>
        )}
      </div>
      <label className="block text-sm">
        Internal note
        <Textarea
          aria-label="Internal note"
          className="mt-2"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={10000}
        />
      </label>
      <Button
        variant="outline"
        disabled={note === (item.internal_note ?? "") || mutation.isPending}
        onClick={() => act("note", { internal_note: note })}
      >
        <Save className="mr-2 size-4" />
        Save note
      </Button>
      <label className="block text-sm">
        Human answer
        <Textarea
          aria-label="Human answer"
          className="mt-2 min-h-28"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          maxLength={20000}
        />
      </label>
      <Button
        disabled={
          !answer.trim() || mutation.isPending || ["resolved", "closed"].includes(item.status)
        }
        onClick={() => act("resolve", { human_answer: answer })}
      >
        <Check className="mr-2 size-4" />
        Resolve case
      </Button>
      <div className="flex flex-wrap gap-2">
        {item.status !== "closed" && (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => act("status", { status: "closed" })}
          >
            <Archive className="mr-2 size-4" /> Close case
          </Button>
        )}
        {["closed", "resolved"].includes(item.status) && (
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => act("status", { status: "open" })}
          >
            <RotateCcw className="mr-2 size-4" /> Reopen case
          </Button>
        )}
      </div>
    </section>
  );
}
