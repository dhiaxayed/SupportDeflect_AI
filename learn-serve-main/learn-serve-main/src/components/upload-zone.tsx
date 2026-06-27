import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload as UploadIcon, FileText, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadDocument } from "@/lib/api";

export function UploadZone({ onFiles }: { onFiles?: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (list: File[]) => {
      for (const file of list) {
        await uploadDocument(file);
      }
    },
    onSuccess: () => {
      toast.success(
        files.length > 1 ? "Documents queued for indexing" : "Document queued for indexing",
      );
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      navigate({ to: "/dashboard/documents" });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Upload failed"),
  });

  const handle = (list: FileList | null) => {
    if (!list) return;
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
          multiple
          accept=".pdf,.txt,.md,.markdown"
          className="sr-only"
          onChange={(e) => handle(e.target.files)}
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
