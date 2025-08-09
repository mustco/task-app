// app/dashboard/_components/DashboardSkeleton.tsx
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-white p-6 rounded-lg shadow">
            <div className="h-4 w-28 bg-slate-200 rounded animate-pulse" />
            <div className="mt-3 h-8 w-20 bg-slate-200 rounded animate-pulse" />
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg shadow border overflow-hidden">
        <div className="h-10 bg-slate-100 border-b" />
        <div className="p-4 space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
