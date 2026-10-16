/**
 * @file Tenant public-URL ingestion view. Submit a URL to the backend fetching/validation
 * boundary and filter the shared document cache for URL sources. Returned ingestion states
 * determine whether the UI reports queueing, completed indexing or a known failure.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Globe, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { QueryState } from "@/components/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { useDocuments } from "@/hooks/use-data";
import { formatDate, indexUrl, mapDocStatus } from "@/lib/api";

export const Route = createFileRoute("/dashboard/sources")({
  /**
   * Set the public-source management route title.
   */
  head: () => ({ meta: [{ title: "URL Sources — SupportDeflect AI" }] }),
  component: Sources,
});

/**
 * Own the URL draft and submit state, show public-content constraints and list URL-source
 * ingestion outcomes from the shared document query.
 */
function Sources() {
  const [url, setUrl] = useState("");
  const query = useDocuments();
  const { data: documents } = query;
  const queryClient = useQueryClient();

  const urlSources = (documents ?? []).filter((d) => d.source_type === "url");

  const indexMutation = useMutation({
    /**
     * Send the chosen URL to the backend rather than fetching page content in the browser;
     * server SSRF/access restrictions remain responsible for safety.
     */
    mutationFn: (target: string) => indexUrl(target),
    /**
     * Report the actual indexed/queued/failed result, clear the submitted URL and invalidate
     * document/quota state so ingestion is monitored consistently.
     */
    onSuccess: (document) => {
      if (document.status === "failed")
        toast.error(document.error_message || "URL indexing failed");
      else toast.success(document.status === "indexed" ? "URL indexed" : "URL queued for indexing");
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "subscription"] });
    },
    /**
     * Display URL validation or ingestion-request failure while keeping the draft available
     * for correction.
     */
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to index URL"),
  });

  return (
    <>
      <DashboardHeader
        title="URL Sources"
        description="Index public web pages into your knowledge base."
      />
      <div className="space-y-6 p-6">
        <Card>
          <CardHeader>
            <CardTitle>Add a URL</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="url">URL</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="url"
                  type="url"
                  maxLength={1024}
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://help.yourcompany.com"
                  className="pl-9"
                />
              </div>
            </div>
            <Alert variant="default" className="border-warning/30 bg-warning/5">
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Public pages only</AlertTitle>
              <AlertDescription>
                Pages behind authentication won't be indexed. For private content, upload files
                directly.
              </AlertDescription>
            </Alert>
            <Button
              disabled={!url.trim() || indexMutation.isPending}
              onClick={() => indexMutation.mutate(url.trim())}
            >
              {indexMutation.isPending ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Indexing…
                </>
              ) : (
                <>
                  <Link2 className="mr-1.5 h-4 w-4" /> Index URL
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>URL sources</CardTitle>
          </CardHeader>
          {query.isPending || query.error ? (
            <QueryState pending={query.isPending} error={query.error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {urlSources.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No URL sources yet.
                    </TableCell>
                  </TableRow>
                )}
                {urlSources.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium max-w-md truncate">{s.source}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.chunk_count || "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={mapDocStatus(s.status)} />
                      {s.error_message && (
                        <p className="mt-1 max-w-md text-xs text-destructive">{s.error_message}</p>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(s.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
