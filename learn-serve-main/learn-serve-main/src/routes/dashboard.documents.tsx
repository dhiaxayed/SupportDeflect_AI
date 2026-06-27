import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileText, Search, Upload, MoreHorizontal, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { useDocuments } from "@/hooks/use-data";
import { deleteDocument, formatDate, mapDocStatus, mapDocType } from "@/lib/api";

export const Route = createFileRoute("/dashboard/documents")({
  head: () => ({ meta: [{ title: "Documents — SupportDeflect AI" }] }),
  component: Documents,
});

function Documents() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const { data: documents, isLoading } = useDocuments();
  const queryClient = useQueryClient();

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteDocument(id),
    onSuccess: () => {
      toast.success("Document deleted");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to delete document"),
  });

  const filtered = (documents ?? []).filter(
    (d) =>
      (status === "all" || mapDocStatus(d.status).toLowerCase() === status) &&
      d.title.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <DashboardHeader
        title="Documents"
        description="Your indexed knowledge base. Upload, monitor and manage sources."
      />
      <div className="space-y-4 p-6">
        <Card className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search documents…"
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="indexed">Indexed</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
            <Button asChild>
              <Link to="/dashboard/upload">
                <Upload className="mr-1.5 h-4 w-4" /> Upload
              </Link>
            </Button>
          </div>
        </Card>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading documents…
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No documents yet"
            description="Upload your first PDF, Markdown file or FAQ to start training your assistant."
            action={{
              label: "Upload documents",
              node: (
                <Button asChild className="mt-5">
                  <Link to="/dashboard/upload">Upload documents</Link>
                </Button>
              ),
            }}
          />
        ) : (
          <Card className="overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Document</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Chunks</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <FileText className="h-4 w-4" />
                        </div>
                        <div className="font-medium max-w-xs truncate">{d.title}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-mono text-muted-foreground">
                        {mapDocType(d)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={mapDocStatus(d.status)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {d.chunk_count || "—"}
                    </TableCell>
                    <TableCell className="capitalize text-muted-foreground">
                      {d.source_type === "url" ? "url" : "upload"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(d.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => removeMutation.mutate(d.id)}
                            disabled={removeMutation.isPending}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>
    </>
  );
}
