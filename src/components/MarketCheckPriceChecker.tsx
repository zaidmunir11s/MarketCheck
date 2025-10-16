import React, { useMemo, useState } from "react";
import { Loader2, Search, Download, Copy, Target, RefreshCw, CircleDollarSign, Settings2, BarChart3, MapPin } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine } from "recharts";

// --- If you're using shadcn/ui in your app, these imports will work out of the box.
// If not, swap them for your own UI kit or simple HTML elements.
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip as UiTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * MarketCheck Price Checker UI
 * -------------------------------------------------------
 * Drop this component anywhere in your dashboard. Set your API key,
 * choose an endpoint (retail comps, wholesale comps, decode VIN), and go.
 *
 * ✅ Clean, responsive UI (TailwindCSS)
 * ✅ VIN or Year/Make/Model + mileage/zip search
 * ✅ Retail comps table with sort + CSV export
 * ✅ Price distribution histogram + suggested offer helper
 * ✅ Demo mode (no API key required) for instant preview
 *
 * NOTE: You MUST supply your MarketCheck API key. See the `API_KEY` constant
 * and the fetch helpers below. Endpoints shown are examples—adjust params
 * to your contract/docs.
 */

const API_BASE = "https://marketcheck-prod.apigee.net/v2"; // typical base; verify with your docs
const API_KEY = import.meta.env.VITE_MARKETCHECK_KEY || ""; // put your key here if not using env

// --- Simple in-memory CSV export
function downloadCSV(filename: string, rows: any[]) {
  if (!rows?.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [headers.join(",")]
    .concat(
      rows.map((r) => headers.map((h) => JSON.stringify(r[h] ?? "")).join(","))
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function asUSD(n: number | null | undefined) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

function median(numbers: number[]) {
  if (!numbers?.length) return 0;
  const a = [...numbers].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

// Demo dataset for instant preview (numbers loosely realistic)
const DEMO_LISTINGS = Array.from({ length: 36 }).map((_, i) => {
  const miles = Math.floor(10000 + Math.random() * 60000);
  const price = Math.floor(18000 + Math.random() * 22000);
  const dom = Math.floor(Math.random() * 90);
  const dist = Math.floor(5 + Math.random() * 150);
  return {
    id: `demo-${i + 1}`,
    vin: `1HGBH41JXMN${(100000 + i).toString().slice(-6)}`,
    seller_name: ["Auto Galaxy", "Prime Motors", "City Cars", "EZ Deals"][i % 4],
    price,
    miles,
    dom,
    distance_miles: dist,
    city: ["Boston", "Providence", "Hartford", "Nashua"][i % 4],
    state: ["MA", "RI", "CT", "NH"][i % 4],
    vdp_url: "https://example.com/listing"
  };
});

export default function MarketCheckPriceChecker() {
  const [tab, setTab] = useState("retail");
  const [isLoading, setIsLoading] = useState(false);
  const [useDemo, setUseDemo] = useState(!API_KEY); // if no key present, default to demo

  // Search form
  const [vin, setVin] = useState("");
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [trim, setTrim] = useState("");
  const [miles, setMiles] = useState("");
  const [zip, setZip] = useState("02141");
  const [radius, setRadius] = useState(150);

  // Filters / knobs
  const [maxDom, setMaxDom] = useState(120);
  const [maxMiles, setMaxMiles] = useState(200000);
  const [sortKey, setSortKey] = useState("price");
  const [sortDir, setSortDir] = useState("asc");
  const [targetMarginPct, setTargetMarginPct] = useState(10); // your desired margin vs. comp median

  const [listings, setListings] = useState<any[]>([]);

  const priceStats = useMemo(() => {
    const prices = listings.map((l) => Number(l.price)).filter(Boolean);
    const mi = listings.map((l) => Number(l.miles)).filter(Boolean);
    if (!prices.length) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const med = median(prices);
    const medMiles = median(mi);
    return { min, max, avg, med, medMiles };
  }, [listings]);

  const histogramData = useMemo(() => {
    if (!listings?.length) return [];
    const prices = listings.map((l) => Number(l.price)).filter(Boolean);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const bins = 10;
    const step = (max - min) / bins || 1;
    const arr = Array.from({ length: bins }).map((_, i) => ({
      bucket: `${asUSD(Math.round(min + i * step))}`,
      count: 0,
      bucketStart: min + i * step,
      bucketEnd: min + (i + 1) * step,
    }));
    prices.forEach((p) => {
      const idx = Math.min(arr.length - 1, Math.floor((p - min) / step));
      arr[idx].count += 1;
    });
    return arr;
  }, [listings]);

  const suggestedOffer = useMemo(() => {
    if (!priceStats) return null;
    const target = priceStats.med * (1 - targetMarginPct / 100);
    return Math.round(target);
  }, [priceStats, targetMarginPct]);

  // --- Build example endpoints -------------------------------------
  // Adjust paths/params per your MarketCheck plan.
  function buildRetailCompsUrl() {
    const params = new URLSearchParams({
      api_key: API_KEY,
      year: year || "",
      make: make || "",
      model: model || "",
      trim: trim || "",
      vins: vin || "",
      zip: zip || "",
      radius: String(radius),
      dom_max: String(maxDom),
      miles_max: String(maxMiles),
      car_type: "used",
      stats: "true",
    });
    // Retail/active listings example; verify with docs:
    return `${API_BASE}/search/car/active?${params.toString()}`;
  }

  async function runRetailComps() {
    setIsLoading(true);
    try {
      if (useDemo || !API_KEY) {
        // demo mode
        await new Promise((r) => setTimeout(r, 600));
        setListings(DEMO_LISTINGS);
        return;
      }
      const url = buildRetailCompsUrl();
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Shape may differ; normalize a common shape
      const rows = (json?.listings || json?.results || []).map((x: any, i: number) => ({
        id: x.id || x.vin || i,
        vin: x.vin,
        seller_name: x.seller_name || x.dealer?.name || "—",
        price: x.price || x.build?.price || x.offer_price || null,
        miles: x.miles || x.build?.mileage || null,
        dom: x.dom || x.days_on_market || null,
        distance_miles: x.distance || x.dealer?.distance || null,
        city: x.dealer?.city || x.city || "",
        state: x.dealer?.state || x.state || "",
        vdp_url: x.vdp_url || x.deeplink || x.url || "",
      }));
      setListings(rows);
    } catch (e) {
      console.error(e);
      alert("Error fetching comps. Check API key/endpoint in the code.");
    } finally {
      setIsLoading(false);
    }
  }

  function sortedListings() {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...listings]
      .filter((l) => (l.dom ?? 0) <= maxDom && (l.miles ?? 0) <= maxMiles)
      .sort((a, b) => {
        const va = a[sortKey] ?? 0;
        const vb = b[sortKey] ?? 0;
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      });
  }

  function copyOffer() {
    if (!suggestedOffer) return;
    navigator.clipboard.writeText(`${suggestedOffer}`);
  }

  function exportCsv() {
    const rows = sortedListings().map((l) => ({
      VIN: l.vin,
      Seller: l.seller_name,
      Price: l.price,
      Miles: l.miles,
      DOM: l.dom,
      DistanceMi: l.distance_miles,
      City: l.city,
      State: l.state,
      URL: l.vdp_url,
    }));
    const file = `marketcheck_comps_${new Date().toISOString().slice(0,10)}.csv`;
    downloadCSV(file, rows);
  }

  function ResetButton() {
    return (
      <Button variant="ghost" size="icon" onClick={() => setListings([])} title="Clear results">
        <RefreshCw className="h-4 w-4" />
      </Button>
    );
  }

  return (
    <TooltipProvider>
      <div className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">MarketCheck Price Checker</h1>
            <p className="text-sm text-muted-foreground mt-1">VIN or YMM search • Retail comps • Price histogram • CSV export</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch id="demo" checked={useDemo || !API_KEY} onCheckedChange={setUseDemo} />
              <Label htmlFor="demo">Demo data</Label>
            </div>
            <ResetButton />
          </div>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2"><Settings2 className="h-5 w-5" /> Search</CardTitle>
            <CardDescription>Enter a VIN for the most precise comps, or use Year/Make/Model. Zip & radius scope the search.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-3">
                <Label htmlFor="vin">VIN (optional)</Label>
                <Input id="vin" placeholder="e.g. 5YJSA1E26JF123456" value={vin} onChange={(e) => setVin(e.target.value)} />
              </div>
              <div className="md:col-span-1">
                <Label htmlFor="year">Year</Label>
                <Input id="year" placeholder="2021" value={year} onChange={(e) => setYear(e.target.value)} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="make">Make</Label>
                <Input id="make" placeholder="Toyota" value={make} onChange={(e) => setMake(e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="model">Model</Label>
                <Input id="model" placeholder="Camry" value={model} onChange={(e) => setModel(e.target.value)} />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="trim">Trim</Label>
                <Input id="trim" placeholder="SE" value={trim} onChange={(e) => setTrim(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div className="md:col-span-2">
                <Label htmlFor="miles">Odometer (mi)</Label>
                <Input id="miles" placeholder="52,300" value={miles} onChange={(e) => setMiles(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="zip">Zip</Label>
                <Input id="zip" placeholder="02141" value={zip} onChange={(e) => setZip(e.target.value)} />
              </div>
              <div className="md:col-span-4">
                <Label>Radius: {radius} mi</Label>
                <Slider value={[radius]} min={10} max={500} step={10} onValueChange={([v]) => setRadius(v)} />
              </div>
              <div className="md:col-span-2">
                <Label>Max DOM: {maxDom} days</Label>
                <Slider value={[maxDom]} min={0} max={365} step={5} onValueChange={([v]) => setMaxDom(v)} />
              </div>
              <div className="md:col-span-2">
                <Label>Max Miles: {maxMiles.toLocaleString()}</Label>
                <Slider value={[maxMiles]} min={20000} max={250000} step={5000} onValueChange={([v]) => setMaxMiles(v)} />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 justify-between">
              <div className="flex items-center gap-3">
                <Button onClick={runRetailComps} disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Get Retail Comps
                </Button>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" onClick={exportCsv} disabled={!listings.length}>
                      <Download className="mr-2 h-4 w-4" /> Export CSV
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Exports current (filtered & sorted) results</TooltipContent>
                </UiTooltip>
              </div>
              <div className="flex items-center gap-2">
                <Label className="whitespace-nowrap">Target Margin</Label>
                <Select value={String(targetMarginPct)} onValueChange={(v) => setTargetMarginPct(Number(v))}>
                  <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[5, 7.5, 10, 12.5, 15, 20].map((p) => (
                      <SelectItem key={p} value={String(p)}>{p}%</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <UiTooltip>
                  <TooltipTrigger asChild>
                    <Button variant="secondary" onClick={copyOffer} disabled={!suggestedOffer}>
                      <Copy className="mr-2 h-4 w-4" /> Copy Offer
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copies median-based target offer to clipboard</TooltipContent>
                </UiTooltip>
              </div>
            </div>
          </CardContent>
        </Card>

        <Tabs value={tab} onValueChange={setTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="retail" className="flex items-center gap-2"><BarChart3 className="h-4 w-4" /> Comps & Stats</TabsTrigger>
            <TabsTrigger value="table" className="flex items-center gap-2"><Target className="h-4 w-4" /> Listings Table</TabsTrigger>
          </TabsList>

          <TabsContent value="retail" className="mt-4 space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                  <CardDescription>Based on current filters</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Count</div>
                    <div className="font-semibold">{listings.length}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Median Price</div>
                    <div className="font-semibold">{priceStats ? asUSD(priceStats.med) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Average Price</div>
                    <div className="font-semibold">{priceStats ? asUSD(Math.round(priceStats.avg)) : "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Price Range</div>
                    <div className="font-semibold">{priceStats ? `${asUSD(priceStats.min)} – ${asUSD(priceStats.max)}` : "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Median Miles</div>
                    <div className="font-semibold">{priceStats?.medMiles?.toLocaleString?.() || "—"}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Suggested Offer</div>
                    <div className="font-semibold flex items-center gap-2">{suggestedOffer ? asUSD(suggestedOffer) : "—"} <CircleDollarSign className="h-4 w-4" /></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="text-base">Price Distribution</CardTitle>
                  <CardDescription>Histogram of listing prices</CardDescription>
                </CardHeader>
                <CardContent style={{ height: 280 }}>
                  {listings.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={histogramData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                        <XAxis dataKey="bucket" tick={{ fontSize: 12 }} interval={0} angle={-25} textAnchor="end" height={60} />
                        <YAxis width={32} tick={{ fontSize: 12 }} />
                        <Tooltip formatter={(v, n, p) => [`${v} listings`, `${p.payload.bucket}`]} />
                        <ReferenceLine x={histogramData.findIndex(b => priceStats && b.bucketStart <= priceStats.med && b.bucketEnd >= priceStats.med)} strokeDasharray="3 3" label={{ value: "Median", position: "insideTopRight" }} />
                        <Bar dataKey="count" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">Run a search to see the chart.</div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="table" className="mt-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Listings</CardTitle>
                <CardDescription>Click column headers to sort</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <Label>Sort</Label>
                    <Select value={sortKey} onValueChange={setSortKey}>
                      <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="price">Price</SelectItem>
                        <SelectItem value="miles">Miles</SelectItem>
                        <SelectItem value="dom">Days on Market</SelectItem>
                        <SelectItem value="distance_miles">Distance</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortDir} onValueChange={setSortDir}>
                      <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Asc</SelectItem>
                        <SelectItem value="desc">Desc</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">{zip} • {radius} mi</span>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted/60">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Dealer</th>
                        <th className="text-left px-3 py-2 font-medium">Price</th>
                        <th className="text-left px-3 py-2 font-medium">Miles</th>
                        <th className="text-left px-3 py-2 font-medium">DOM</th>
                        <th className="text-left px-3 py-2 font-medium">Dist</th>
                        <th className="text-left px-3 py-2 font-medium">City</th>
                        <th className="text-left px-3 py-2 font-medium">State</th>
                        <th className="text-left px-3 py-2 font-medium">Link</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedListings().map((l) => (
                        <tr key={l.id} className="border-t">
                          <td className="px-3 py-2 whitespace-nowrap">{l.seller_name || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{asUSD(l.price)}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.miles?.toLocaleString?.() || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.dom ?? "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.distance_miles ? `${Math.round(l.distance_miles)} mi` : "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.city || ""}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{l.state || ""}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {l.vdp_url ? (
                              <a href={l.vdp_url} className="text-primary hover:underline" target="_blank" rel="noreferrer">View</a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                      {!listings.length && (
                        <tr>
                          <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No results yet. Run a search.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <Card className="border-dashed">
          <CardHeader>
            <CardTitle className="text-base">Integration Notes</CardTitle>
            <CardDescription>Hook up your endpoints in minutes.</CardDescription>
          </CardHeader>
          <CardContent className="prose prose-sm max-w-none">
            <ul>
              <li>
                Set your API key at <code>VITE_MARKETCHECK_KEY</code> (or hardcode <code>API_KEY</code> above for quick tests).
              </li>
              <li>
                Update <code>API_BASE</code> and <code>runRetailComps()</code> to match your contracted endpoints and response shape. This UI normalizes common fields.
              </li>
              <li>
                VIN decode flow: call <code>{`${API_BASE}/vin/${'YOURVIN'}?api_key=...`}</code> or the docs-recommended VIN decode endpoint, then prefill YMM/trim.
              </li>
              <li>
                Wholesale logic: if you have a wholesale comps endpoint, add a new tab and fetch similarly; the stats/offer helper will work out of the box.
              </li>
              <li>
                Offer helper: "Target Margin" slider computes <em>median price × (1 − margin%)</em>. Adjust the formula to include your pack/fees.
              </li>
            </ul>
          </CardContent>
        </Card>

        <div className="text-xs text-muted-foreground text-center">
          UI only • Not affiliated with MarketCheck • Use responsibly and per your data license
        </div>
      </div>
    </TooltipProvider>
  );
}

