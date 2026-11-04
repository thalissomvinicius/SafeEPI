import { notFound } from "next/navigation"
import { isPreviewReadOnly } from "@/lib/previewEnvironment"
import { PreviewRecoveryLab } from "@/components/preview/PreviewRecoveryLab"

export default function PreviewLabPage() {
  if (!isPreviewReadOnly()) notFound()
  return <PreviewRecoveryLab />
}
