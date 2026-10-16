/**
 * @file Tenant knowledge-file selection and sequential multipart-upload workflow. Track files
 * not yet accepted so a partial network failure can be retried without duplicating successful
 * uploads. Completed uploads refresh document/quota caches and navigate to the document status
 * list, which follows background ingestion.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload as UploadIcon, FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadDocument, type BackendDocument } from "@/lib/api";

/**
 * Manage drag/drop and picker selection, pending files, removal and batch submission while
 * disabling edits during requests.
 */
export function UploadZone({ onFiles }: { onFiles?: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    /**
     * Upload files in order and remove each accepted File from the pending list immediately; a
     * later failure leaves only unaccepted files available for retry.
     */
    mutationFn: async (list: File[]) => {
      const results: BackendDocument[] = [];
      for (const file of list) {
        results.push(await uploadDocument(file));
        // Keep only unaccepted files if a later request fails; retry must not duplicate uploads.
        setFiles((pending) => pending.filter((candidate) => candidate !== file));
      }
      return results;
    },
    /**
     * Report backend ingestion state rather than assuming queue acceptance means indexing
     * succeeded, refresh knowledge/usage and open document monitoring.
     */
    onSuccess: (results) => {
      const failed = results.find((document) => document.status === "failed");
      if (failed) toast.error(failed.error_message || "Document indexing failed");
      else
        toast.success(
          results.every((document) => document.status === "indexed")
            ? "Documents indexed"
            : "Documents queued for indexing",
        );
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "subscription"] });
      navigate({ to: "/dashboard/documents" });
    },
    /**
     * Refresh caches because earlier files may already have succeeded, then present the
     * transport error while retaining the remaining upload queue.
     */
    onError: (err) => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["settings", "subscription"] });
      toast.error(err instanceof Error ? err.message : "Upload failed");
    },
  });

  /**
   * Append selected files only when no upload is in flight and notify the optional selection
   * observer; file parsing and authoritative size/type validation remain server-side.
   */
  const handle = (list: FileList | null) => {
    if (!list || uploadMutation.isPending) return;
    const arr = Array.from(list);
    setFiles((p) => [...p, ...arr]);
    onFiles?.(arr);
  };

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-8 py-16 text-center transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border bg-muted/20 hover:bg-muted/40"
        }`}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UploadIcon className="h-5 w-5" />
        </div>
        <div className="mt-4 text-base font-semibold">Drop files or click to browse</div>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          PDF, TXT or Markdown. We'll chunk, embed and index them into your private knowledge base.
        </p>
        <input
          type="file"
          aria-label="Upload knowledge files"
          disabled={uploadMutation.isPending}
          multiple
          accept=".pdf,.txt,.md,.markdown"
          className="sr-only"
          onChange={(e) => {
            handle(e.target.files);
            // A removed file must be selectable again without choosing another file first.
            e.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border bg-card p-3">
              <FileText className="h-4 w-4 text-primary" />
              <div className="flex-1 min-w-0">
                <div className="truncate text-sm font-medium">{f.name}</div>
                <div className="text-xs text-muted-foreground">{(f.size / 1024).toFixed(1)} KB</div>
              </div>
              <button
                type="button"
                title={`Remove ${f.name}`}
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                disabled={uploadMutation.isPending}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button
            className="w-full sm:w-auto"
            onClick={() => uploadMutation.mutate(files)}
            disabled={uploadMutation.isPending}
          >
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Queueing…
              </>
            ) : (
              "Start indexing"
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
