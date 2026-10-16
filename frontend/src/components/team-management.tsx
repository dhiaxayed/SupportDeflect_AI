/**
 * @file Tenant-admin member/invitation management connected to /team endpoints. Account
 * activation, pending invitation expiry and mail delivery are displayed separately; local
 * Mailpit capture is not external inbox delivery. Mutations invalidate the shared team cache
 * used by Inbox assignment, while polling follows still-pending invitations.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Mail, UserPlus, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { QueryState } from "@/components/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-auth";
import {
  apiRequest,
  createTeamUser,
  getTeam,
  getTeamMailStatus,
  updateTeamUser,
  type TeamUser,
} from "@/lib/api";

/**
 * Render member creation, role/active-state controls and invitation renewal with current-user
 * and in-flight restrictions reflected in the UI.
 */
export function Team() {
  const queryClient = useQueryClient();
  const team = useQuery({
    queryKey: ["team"],
    queryFn: getTeam,
    /**
     * Poll every five seconds only while an active invited member must still replace temporary
     * credentials; settled membership lists stop this extra polling.
     */
    refetchInterval: (query) =>
      query.state.data?.some((member) => member.is_active && member.must_change_password)
        ? 5000
        : false,
  });
  const mail = useQuery({
    queryKey: ["team-mail-status"],
    queryFn: getTeamMailStatus,
    refetchInterval: 15000,
  });
  const { data: current } = useCurrentUser();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<TeamUser["role"]>("support_agent");
  const create = useMutation({
    /**
     * Create a member from the selected tenant role, name and email; the backend generates and
     * queues the invitation credentials.
     */
    mutationFn: () => createTeamUser({ email, full_name: name, role }),
    /**
     * Clear the invitation draft, refresh the shared member list and report that mail was
     * queued rather than delivered.
     */
    onSuccess: () => {
      setEmail("");
      setName("");
      void queryClient.invalidateQueries({ queryKey: ["team"] });
      toast.success("Team member created. Invitation email queued.");
    },
    /**
     * Display member-creation failure while preserving form values for correction.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const update = useMutation({
    /**
     * Patch only the chosen member's supplied changes; the backend validates self-protection,
     * accepted/pending credentials and role transitions.
     */
    mutationFn: ({ id, changes }: { id: string; changes: Partial<TeamUser> }) =>
      updateTeamUser(id, changes),
    /**
     * Reload the authoritative team list so role or activation changes are reflected in
     * membership and assignment choices.
     */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team"] });
    },
    /**
     * Display an account-update rejection without locally changing the persisted role or
     * active state.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  const invite = useMutation({
    /**
     * Renew a pending invitation through the dedicated endpoint rather than attempting to
     * resend old plaintext credentials.
     */
    mutationFn: (id: string) => apiRequest(`/team/users/${id}/invite`, { method: "POST" }),
    /**
     * Refresh invitation/account metadata and explain that renewed credentials revoke the
     * previous invitation.
     */
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["team"] });
      toast.success("Invitation renewed. Previous credentials are no longer valid.");
    },
    /**
     * Show invitation-renewal failure, including cases where a live delivery claim prevents
     * safe rotation.
     */
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <>
      <DashboardHeader
        title="Team"
        description="Manage your workspace members and support agents."
      />
      <div className="p-4 md:p-6 space-y-6">
        {mail.data && (
          <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
            <Mail className="size-4 shrink-0" />
            {mail.data.detail === "local_capture"
              ? "Local email capture only. External delivery is disabled."
              : !mail.data.connected
                ? "Email worker offline"
                : !mail.data.smtp_ready
                  ? "Email delivery unavailable"
                  : "SMTP connection ready"}
          </div>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Invite a team member</CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose their role and send an invitation to your workspace.
            </p>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 items-end"
              onSubmit={(e) => {
                e.preventDefault();
                create.mutate();
              }}
            >
              <label className="space-y-2 text-sm">
                Full name
                <Input
                  aria-label="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={160}
                />
              </label>
              <label className="space-y-2 text-sm">
                Email
                <Input
                  aria-label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="off"
                />
              </label>
              <label className="space-y-2 text-sm">
                Role
                <select
                  className="field-select"
                  value={role}
                  onChange={(e) => setRole(e.target.value as TeamUser["role"])}
                >
                  <option value="support_agent">Support agent</option>
                  <option value="tenant_admin">Tenant admin</option>
                </select>
              </label>
              <Button type="submit" disabled={create.isPending}>
                <UserPlus className="mr-2 size-4" />
                Invite member
              </Button>
            </form>
          </CardContent>
        </Card>
        <QueryState pending={team.isPending} error={team.error} />
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Workspace members</CardTitle>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[820px]">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Invitation email</th>
                  <th>Account</th>
                </tr>
              </thead>
              <tbody>
                {team.data?.map((member) => (
                  <tr key={member.id}>
                    <td>{member.full_name || "-"}</td>
                    <td>{member.email}</td>
                    <td>
                      <select
                        aria-label={`Role for ${member.email}`}
                        className="field-select"
                        value={member.role}
                        disabled={member.id === current?.id || update.isPending}
                        onChange={(e) =>
                          update.mutate({
                            id: member.id,
                            changes: { role: e.target.value as TeamUser["role"] },
                          })
                        }
                      >
                        <option value="support_agent">Support agent</option>
                        <option value="tenant_admin">Tenant admin</option>
                      </select>
                    </td>
                    <td>
                      <Badge variant={member.is_active ? "secondary" : "outline"}>
                        {!member.is_active
                          ? "Inactive"
                          : member.invitation_state === "expired"
                            ? "Invitation expired"
                            : member.must_change_password
                              ? "Invited"
                              : "Active"}
                      </Badge>
                    </td>
                    <td>
                      {member.must_change_password ? (
                        <>
                          <Badge variant="outline">{invitationDeliveryLabel(member)}</Badge>
                          {member.temporary_password_expires_at && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              Expires{" "}
                              {new Date(member.temporary_password_expires_at).toLocaleString()}
                            </div>
                          )}
                          {member.invitation_delivery?.error_code && (
                            <div className="mt-1 text-xs text-destructive">
                              {member.invitation_delivery.error_code === "delivery_unknown"
                                ? "SMTP outcome unknown"
                                : member.invitation_delivery.error_code ===
                                    "invitation_credentials_unavailable"
                                  ? "Renew invitation"
                                  : member.invitation_delivery.error_code.replaceAll("_", " ")}
                            </div>
                          )}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td>
                      {member.is_active && member.must_change_password && (
                        <Button
                          variant="outline"
                          size="icon"
                          className="mr-2"
                          title={
                            member.invitation_delivery?.status === "sending"
                              ? "Invitation is being sent"
                              : "Renew invitation and invalidate previous credentials"
                          }
                          aria-label={`Resend invitation to ${member.email}`}
                          disabled={
                            invite.isPending || member.invitation_delivery?.status === "sending"
                          }
                          onClick={() => invite.mutate(member.id)}
                        >
                          <Mail className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="icon"
                        title={member.is_active ? "Deactivate member" : "Activate member"}
                        aria-label={member.is_active ? "Deactivate member" : "Activate member"}
                        disabled={member.id === current?.id || update.isPending}
                        onClick={() =>
                          update.mutate({
                            id: member.id,
                            changes: { is_active: !member.is_active },
                          })
                        }
                      >
                        {member.is_active ? (
                          <UserX className="size-4" />
                        ) : (
                          <UserCheck className="size-4" />
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/**
 * Translate outbox state into an honest display label, distinguishing local capture from SMTP
 * acceptance and keeping account acceptance independent.
 */
function invitationDeliveryLabel(member: TeamUser) {
  const delivery = member.invitation_delivery;
  if (!delivery) return "Not queued";
  if (delivery.status === "sent")
    return delivery.mode === "local_capture" ? "Captured locally" : "SMTP accepted";
  return { queued: "Queued", sending: "Sending", failed: "Failed", canceled: "Canceled" }[
    delivery.status
  ];
}
