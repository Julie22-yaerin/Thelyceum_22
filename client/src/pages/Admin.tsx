import { useEffect, useState } from "react";
import { Lock, RefreshCw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/*
 * The Lyceum — Admin
 * Lists paid orders (customer, organization, product, license key) sourced
 * from the Lemon Squeezy webhook in server/index.ts. Gated behind an
 * ADMIN_TOKEN sent as the `x-admin-token` header — set it in .env and on
 * your deploy platform, then share the value with whoever needs access.
 */

interface OrderRow {
  ref: string;
  status: "pending" | "paid";
  licenseKey?: string;
  product?: string;
  email?: string;
  name?: string;
  organization?: string;
  paidAt?: number;
}

const STORAGE_KEY = "lyceum_admin_token";

export default function Admin() {
  const [token, setToken] = useState(() => sessionStorage.getItem(STORAGE_KEY) || "");
  const [tokenInput, setTokenInput] = useState("");
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  const fetchOrders = async (authToken: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/orders", {
        headers: { "x-admin-token": authToken },
      });
      if (res.status === 401) {
        setError("Invalid admin token.");
        sessionStorage.removeItem(STORAGE_KEY);
        setToken("");
        setOrders(null);
        return;
      }
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchOrders(token);
  }, [token]);

  const handleUnlock = () => {
    if (!tokenInput.trim()) return;
    sessionStorage.setItem(STORAGE_KEY, tokenInput.trim());
    setToken(tokenInput.trim());
  };

  const copyKey = async (ref: string, key: string) => {
    await navigator.clipboard.writeText(key);
    setCopiedRef(ref);
    setTimeout(() => setCopiedRef(null), 1500);
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-warm-white flex items-center justify-center px-6">
        <div className="max-w-sm w-full text-center">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-teal/10 flex items-center justify-center">
            <Lock className="w-5 h-5 text-teal" />
          </div>
          <h1 className="font-display text-lg font-semibold text-foreground mb-4">Admin access</h1>
          <Input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Admin token"
            className="mb-3"
            autoFocus
          />
          <Button onClick={handleUnlock} className="w-full bg-teal hover:bg-teal-dark text-white">
            Unlock
          </Button>
          {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-warm-white px-6 py-10">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-2xl font-semibold text-foreground">Orders</h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOrders(token)}
            disabled={loading}
            className="border-border"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {!orders ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">License Key</th>
                  <th className="px-4 py-3 font-medium">Paid At</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.ref} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground">{o.name || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{o.organization || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">{o.email || "—"}</td>
                    <td className="px-4 py-3 text-foreground">{o.product || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center h-5 px-2 rounded-full text-[10px] font-medium uppercase tracking-wide ${
                          o.status === "paid" ? "bg-teal/10 text-teal" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {o.licenseKey ? (
                        <button
                          onClick={() => copyKey(o.ref, o.licenseKey!)}
                          className="inline-flex items-center gap-1.5 font-mono text-xs text-foreground hover:text-teal transition-colors"
                        >
                          {o.licenseKey.slice(0, 12)}…
                          {copiedRef === o.ref ? (
                            <Check className="w-3 h-3 text-teal" />
                          ) : (
                            <Copy className="w-3 h-3 text-muted-foreground" />
                          )}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {o.paidAt ? new Date(o.paidAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
