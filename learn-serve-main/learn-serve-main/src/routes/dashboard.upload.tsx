import { createFileRoute } from "@tanstack/react-router";
import { DashboardHeader } from "@/components/dashboard-header";
import { UploadZone } from "@/components/upload-zone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export const Route = createFileRoute("/dashboard/upload")({
  head: () => ({ meta: [{ title: "Upload — SupportDeflect AI" }] }),
  component: UploadPage,
});

function UploadPage() {
  return (
    <>
      <DashboardHeader
        title="Upload documents"
        description="Add files to your private knowledge base."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>What to upload</AlertTitle>
            <AlertDescription>
              Upload product documentation, FAQs, guides, release notes or support policies.
              SupportDeflect will chunk, embed and index them into your private knowledge base.
            </AlertDescription>
          </Alert>
          <Card>
            <CardContent className="p-6">
              <UploadZone />
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Tips for great answers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>• Prefer focused docs over giant PDFs — smaller files index faster.</p>
            <p>• Keep headings & sections clear; chunks are split semantically.</p>
            <p>• Re-upload when your product changes to keep answers current.</p>
            <p>
              • Use <strong>URL Sources</strong> to crawl your live help center.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
