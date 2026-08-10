import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const kpis = [
  { title: "Entries", value: "–", hint: "total media entries" },
  { title: "Storage used", value: "–", hint: "across all drivers" },
  { title: "Queue depth", value: "–", hint: "jobs waiting to transcode" },
  { title: "Plays today", value: "–", hint: "last 24h" },
]

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div className="grid auto-rows-min gap-4 md:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {kpi.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold tracking-tight">
                {kpi.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-h-[16rem]">
          <CardHeader>
            <CardTitle>Entries by status</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Placeholder — will render per-status counts from{" "}
            <code className="text-foreground">/api/dashboard</code>.
          </CardContent>
        </Card>
        <Card className="min-h-[16rem]">
          <CardHeader>
            <CardTitle>Recent uploads</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Placeholder — will list the latest entries with uploader and status
            badges.
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
