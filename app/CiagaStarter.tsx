'use client';

import React from "react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { MapPin, Trophy, Activity, Users, Target, Compass, Play, Pause } from "lucide-react"
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { AuthUser } from "@/components/ui/auth-user";


// --- Fake data to make the preview feel real ---
const leaderboard = [
  { name: "Alex", points: 115, handicap: 10.2, last: "T3" },
  { name: "Sam", points: 103, handicap: 12.4, last: "2" },
  { name: "Casey", points: 97, handicap: 8.8, last: "T5" },
  { name: "Jordan", points: 90, handicap: 14.1, last: "1" },
]

const handicapTrend = [
  { r: 1, idx: 16.4 },
  { r: 2, idx: 15.9 },
  { r: 3, idx: 15.1 },
  { r: 4, idx: 14.6 },
  { r: 5, idx: 14.4 },
  { r: 6, idx: 13.9 },
  { r: 7, idx: 13.3 },
  { r: 8, idx: 12.8 },
]

const holes = Array.from({ length: 18 }, (_, i) => i + 1)

export default function CIAGAStarter() {
  const [activeHole, setActiveHole] = useState(1)
  const [strokes, setStrokes] = useState<Record<number, number>>({})
  const [scoring, setScoring] = useState<"strokes" | "stableford">("strokes")
  const [roundLive, setRoundLive] = useState(false)

  const total = Object.values(strokes).reduce((a, b) => a + b, 0)

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      {/* Top app bar */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-2xl bg-primary/10 grid place-items-center">
              <Target className="h-5 w-5" />
            </div>
            <span className="font-bold tracking-tight text-lg">CIAGA Golf</span>
            <Badge variant="secondary" className="ml-2">PWA</Badge>
          </div>
          <div className="flex items-center gap-3">
            <Select defaultValue="2025 Season">
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Season" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="2025 Season">2025 Season</SelectItem>
                <SelectItem value="2024 Season">2024 Season</SelectItem>
              </SelectContent>
            </Select>
            <AuthUser />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <section className="lg:col-span-2 grid gap-6">
          <Tabs defaultValue="dashboard" className="w-full">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="round">Live Round</TabsTrigger>
              <TabsTrigger value="league">League</TabsTrigger>
            </TabsList>
            <TabsContent value="dashboard" className="space-y-6">
              <div className="grid md:grid-cols-3 gap-4">
                <Card className="shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Next Event</CardTitle>
                    <Trophy className="h-4 w-4" />
                  </CardHeader>
                  <CardContent className="text-sm leading-6">
                    <div className="font-semibold">Autumn Classic</div>
                    <div className="text-muted-foreground">Sat 16 Nov • 10:10</div>
                    <div className="flex items-center gap-1 mt-2 text-muted-foreground">
                      <MapPin className="h-3.5 w-3.5" />
                      <span>Royal Downs • White Tees</span>
                    </div>
                    <Button size="sm" className="mt-3 w-full">View Pairings</Button>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Season Points</CardTitle>
                    <Activity className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end justify-between">
                      <div>
                        <div className="text-3xl font-bold">115</div>
                        <div className="text-xs text-muted-foreground">You are P1 • +12 lead</div>
                      </div>
                      <Progress value={72} className="w-[120px]" />
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader className="pb-3 flex flex-row items-center justify-between">
                    <CardTitle className="text-sm font-medium">Handicap Index</CardTitle>
                    <Users className="h-4 w-4" />
                  </CardHeader>
                  <CardContent>
                    <div className="text-3xl font-bold">12.8</div>
                    <div className="text-xs text-muted-foreground">Last updated 28 Oct</div>
                  </CardContent>
                </Card>
              </div>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Progression</CardTitle>
                </CardHeader>
                <CardContent className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={handicapTrend} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="r" tickLine={false} axisLine={false} label={{ value: "Rounds", position: "insideBottomRight", offset: -2 }} />
                      <YAxis tickLine={false} axisLine={false} domain={[0, "dataMax + 2"]} label={{ value: "Index", angle: -90, position: "insideLeft" }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="idx" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-2"><CardTitle>Leaderboard — Season</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead className="text-right">Pts</TableHead>
                        <TableHead className="text-right">Hcp</TableHead>
                        <TableHead className="text-right">Last</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {leaderboard.map((p, i) => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{i + 1}. {p.name}</TableCell>
                          <TableCell className="text-right">{p.points}</TableCell>
                          <TableCell className="text-right">{p.handicap.toFixed(1)}</TableCell>
                          <TableCell className="text-right">{p.last}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="round" className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader className="pb-3 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle>Live Scorecard</CardTitle>
                    <p className="text-sm text-muted-foreground">Royal Downs • White • Stroke Play</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={roundLive ? "default" : "secondary"} className="uppercase tracking-wide">{roundLive ? "Live" : "Paused"}</Badge>
                    <Button size="sm" variant={roundLive ? "secondary" : "default"} onClick={() => setRoundLive(v => !v)}>
                      {roundLive ? <Pause className="h-4 w-4 mr-1"/> : <Play className="h-4 w-4 mr-1"/>}
                      {roundLive ? "Pause" : "Go Live"}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid md:grid-cols-3 gap-4">
                    <div className="md:col-span-2">
                      <div className="flex flex-wrap gap-2">
                        {holes.map(h => (
                          <Button key={h} size="sm" variant={activeHole === h ? "default" : "secondary"} className="w-10" onClick={() => setActiveHole(h)}>
                            {h}
                          </Button>
                        ))}
                      </div>

                      <div className="mt-4 rounded-2xl border p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs text-muted-foreground">Hole</div>
                            <div className="text-2xl font-semibold">{activeHole}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Par</div>
                            <div className="text-2xl font-semibold">4</div>
                          </div>
                        </div>
                        <Separator className="my-4" />
                        <div className="grid grid-cols-3 gap-3 items-end">
                          <div>
                            <Label className="text-xs">Strokes</Label>
                            <div className="flex items-center gap-2 mt-2">
                              <Button size="icon" variant="secondary" onClick={() => setStrokes(s => ({ ...s, [activeHole]: Math.max(1, (s[activeHole] || 0) - 1) }))}>-</Button>
                              <Input className="w-20 text-center" value={strokes[activeHole] || 0} onChange={(e) => setStrokes(s => ({ ...s, [activeHole]: parseInt(e.target.value || "0") }))} />
                              <Button size="icon" onClick={() => setStrokes(s => ({ ...s, [activeHole]: (s[activeHole] || 0) + 1 }))}>+</Button>
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs">Scoring</Label>
                            <Select defaultValue={scoring} onValueChange={(v) => setScoring(v as any)}>
                              <SelectTrigger className="mt-2">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="strokes">Strokes</SelectItem>
                                <SelectItem value="stableford">Stableford</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Total</div>
                            <div className="text-2xl font-semibold">{total}</div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Rangefinder / Caddy */}
                    <div className="rounded-2xl border overflow-hidden">
                      <div className="h-40 bg-muted grid place-items-center">
                        {/* Map placeholder – mount Mapbox here in real app */}
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <Compass className="h-4 w-4" />
                          <span>Map • Rangefinder</span>
                        </div>
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">To Center</span>
                          <span className="text-xl font-semibold">142 m</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">Wind (NW)</span>
                          <span className="font-medium">6 m/s</span>
                        </div>
                        <Separator />
                        <div>
                          <div className="text-xs text-muted-foreground mb-1">AI Caddy Suggestion</div>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold">7 Iron</span>
                            <Badge>Carry ~150 m</Badge>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-2"><CardTitle>Group Scores (Live)</CardTitle></CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        { name: "You", out: 41, inn: 40 },
                        { name: "Sam", out: 42, inn: 39 },
                        { name: "Casey", out: 39, inn: 41 },
                        { name: "Jordan", out: 44, inn: 42 },
                      ].map((p) => (
                        <TableRow key={p.name}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right">{p.out}</TableCell>
                          <TableCell className="text-right">{p.inn}</TableCell>
                          <TableCell className="text-right font-semibold">{p.out + p.inn}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="league" className="space-y-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Events</CardTitle>
                </CardHeader>
                <CardContent className="grid md:grid-cols-2 gap-4">
                  {[
                    { title: "Spring Opener", date: "Sat 12 Apr", course: "Heathlands", tee: "Yellow" },
                    { title: "Summer Cup", date: "Sat 28 Jun", course: "Heathlands", tee: "White" },
                    { title: "Autumn Classic", date: "Sat 16 Nov", course: "Royal Downs", tee: "White" },
                    { title: "Winter Final", date: "Sat 6 Dec", course: "Royal Downs", tee: "Blue" },
                  ].map((e) => (
                    <Card key={e.title} className="border-muted-foreground/20">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base font-semibold">{e.title}</CardTitle>
                      </CardHeader>
                      <CardContent className="text-sm text-muted-foreground">
                        <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5"/> {e.course} • {e.tee}</div>
                        <div className="mt-1">{e.date}</div>
                        <div className="mt-3 flex gap-2">
                          <Button size="sm">View</Button>
                          <Button size="sm" variant="secondary">Pairings</Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader className="pb-2"><CardTitle>Betting (Points Only)</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid md:grid-cols-3 gap-4">
                    {leaderboard.map((p) => (
                      <Card key={p.name}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">{p.name}</CardTitle>
                            <Badge variant="secondary">Win 24%</Badge>
                          </div>
                        </CardHeader>
                        <CardContent className="text-sm">
                          <div className="flex items-center justify-between">
                            <span>Top-3</span>
                            <span className="font-medium">52%</span>
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <span>H2H vs You</span>
                            <span className="font-medium">48%</span>
                          </div>
                          <Button className="mt-3 w-full" variant="secondary">Add to Slip</Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </section>

        {/* Right column */}
        <aside className="space-y-6">
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2"><Trophy className="h-4 w-4"/> Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full">Create Casual Round</Button>
              <Button className="w-full" variant="secondary">Start League Event</Button>
              <Button className="w-full" variant="outline">Add Course</Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle>Bag Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {[
                { club: "Driver", carry: 230 },
                { club: "7 Iron", carry: 150 },
                { club: "PW", carry: 115 },
                { club: "Putter", carry: 0 },
              ].map((c) => (
                <div key={c.club} className="flex items-center justify-between">
                  <span>{c.club}</span>
                  <Badge variant="secondary">{c.carry} m</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle>Course Conditions</CardTitle>
            </CardHeader>
            <CardContent className="text-sm space-y-2">
              <div className="flex items-center justify-between"><span>Weather</span><span className="font-medium">12°C • Breezy</span></div>
              <div className="flex items-center justify-between"><span>Green Speed</span><span className="font-medium">Med-Fast</span></div>
              <div className="flex items-center justify-between"><span>Pin Position</span><span className="font-medium">Back</span></div>
            </CardContent>
          </Card>
        </aside>
      </main>

      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        Built with Next.js • shadcn/ui • Tailwind — Designed for no-CSS builds
      </footer>
    </div>
  )
}
