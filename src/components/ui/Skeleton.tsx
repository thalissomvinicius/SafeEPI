import { cn } from "@/lib/utils"

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
  variant?: 'circle' | 'rect' | 'text'
}

export function Skeleton({ className, variant = 'rect', ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-slate-200/60 rounded-md",
        variant === 'circle' && "rounded-full",
        variant === 'text' && "h-3 w-3/4 mb-2",
        className
      )}
      {...props}
    />
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
    return (
        <div className="w-full space-y-4 p-4">
            <div className="flex space-x-4 mb-6">
                <Skeleton className="h-10 w-48" />
                <div className="flex-1" />
                <Skeleton className="h-10 w-32" />
            </div>
            {[...Array(rows)].map((_, i) => (
                <div key={i} className="flex items-center space-x-4 py-3 border-b border-slate-50">
                    <Skeleton className="h-12 w-12" variant="circle" />
                    <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-1/4" />
                        <Skeleton className="h-3 w-1/2" />
                    </div>
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-8 w-8" variant="circle" />
                </div>
            ))}
        </div>
    )
}
