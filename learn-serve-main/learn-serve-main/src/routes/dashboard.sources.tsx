import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Globe, ShieldAlert, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
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
  head: () => ({ meta: [{ title: "URL Sources — SupportDeflect AI" }] }),
  component: Sources,
});

function Sources() {
  const [url, setUrl] = useState("");
  const { data: documents } = useDocuments();
  const queryClient = useQueryClient();

  const urlSources = (documents ?? []).filter((d) => d.source_type === "url");

  const indexMutation = useMutation({
    mutationFn: (target: string) => indexUrl(target),
    onSuccess: () => {
      toast.success("URL indexed");
      setUrl("");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
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
              disabled={!url || indexMutation.isPending}
              onClick={() => indexMutation.mutate(url)}
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
            <CardTitle>Indexed URLs</CardTitle>
          </CardHeader>
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
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No URL sources yet.
                  </TableCell>
                </TableRow>
              )}
              {urlSources.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium max-w-md truncate">{s.source}</TableCell>
                  <TableCell className="text-right tabular-nums">{s.chunk_count || "—"}</TableCell>
                  <TableCell>
                    <StatusBadge status={mapDocStatus(s.status)} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(s.created_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
