import { useEffect, useState } from "react";
import { Check, Copy, Loader2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCalEmbed } from "@/hooks/useCalEmbed";
import { CredentialUsage } from "@/components/CredentialUsage";

/*
 * The Lyceum — Waiting page
 * Polls /api/orders/:ref (populated by the Lemon Squeezy webhook in
 * server/index.ts) until the license key is ready, then reveals it plus a
 * booking link and Slack invite.
 */

const CAL_LINK = import.meta.env.VITE_CAL_LINK || "nhu-y-pham-aliana-afiwbr/thelyceum.site";
const CAL_NAMESPACE = import.meta.env.VITE_CAL_NAMESPACE || "thelyceum.site";
const SLACK_INVITE_URL = import.meta.env.VITE_SLACK_INVITE_URL || "";

interface OrderStatus {
  status: "pending" | "paid";
  licenseKey?: string;
  product?: string;
}

export default function Waiting() {
  useCalEmbed();
  const ref = new URLSearchParams(window.location.search).get("ref") ?? "";
  const [order, setOrder] = useState<OrderStatus>({ status: "pending" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!ref) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(ref)}`);
        const data: OrderStatus = await res.json();
        if (!cancelled) setOrder(data);
      } catch {
        // network hiccup — the interval will retry
      }
    };

    poll();
    const interval = setInterval(() => {
      if (order.status === "paid") {
        clearInterval(interval);
        return;
      }
      poll();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);

  const copyKey = async () => {
    if (!order.licenseKey) return;
    await navigator.clipboard.writeText(order.licenseKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6 py-16">
      <div className="max-w-lg w-full text-center">
        {!ref ? (
          <p className="text-muted-foreground text-sm">
            Missing order reference. Please use the link from your checkout confirmation.
          </p>
        ) : order.status === "pending" ? (
          <>
            <Loader2 className="w-8 h-8 mx-auto mb-5 text-teal animate-spin" />
            <h1 className="font-display text-xl font-semibold text-foreground mb-2">
              Confirming your payment…
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              This usually takes a few seconds. Keep this tab open — your license key
              will appear here automatically.
            </p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-teal/10 flex items-center justify-center">
              <Check className="w-7 h-7 text-teal" />
            </div>
            <h1 className="font-display text-xl font-semibold text-foreground mb-1.5">
              You're all set{order.product ? ` — ${order.product}` : ""}
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              Here's your license key. Save it somewhere safe.
            </p>

            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-3 mb-6">
              <code className="flex-1 text-left text-sm font-mono text-foreground break-all">
                {order.licenseKey}
              </code>
              <button
                onClick={copyKey}
                className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors"
                aria-label="Copy license key"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-teal" />
                ) : (
                  <Copy className="w-4 h-4 text-muted-foreground" />
                )}
              </button>
            </div>

            <div className="flex flex-col gap-2.5 mb-8">
              <Button
                size="lg"
                data-cal-link={CAL_LINK}
                data-cal-namespace={CAL_NAMESPACE}
                data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
                className="w-full bg-teal hover:bg-teal-dark text-white"
              >
                Book a call with the founder
              </Button>

              {SLACK_INVITE_URL && (
                <a
                  href={SLACK_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full inline-flex items-center justify-center h-10 rounded-lg text-sm font-medium border border-border text-foreground hover:bg-muted transition-colors"
                >
                  <MessageCircle className="w-4 h-4 mr-2" />
                  Join our Slack
                </a>
              )}
            </div>

            {order.licenseKey && <CredentialUsage licenseKey={order.licenseKey} />}
          </>
        )}
      </div>
    </div>
  );
}
