"use client"

import { PageRecovery } from "@/components/ui/PageRecovery"

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <PageRecovery retry={retry} digest={error.digest} />
}
