import { Card, CardContent } from "@/components/ui/card"

export function PagePlaceholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <Card className="flex-1">
        <CardContent className="flex h-full min-h-[16rem] items-center justify-center p-6 text-sm text-muted-foreground">
          Coming soon — wired to the API in a later pass.
        </CardContent>
      </Card>
    </div>
  )
}
