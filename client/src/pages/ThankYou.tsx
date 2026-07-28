import { useLocation } from "wouter";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCalEmbed } from "@/hooks/useCalEmbed";

/*
 * The Lyceum — Thank You page
 * Shown after a successful Lemon Squeezy checkout (via checkout[redirect_url]).
 * Offers a Cal.com booking widget; visitors can also skip straight to the
 * waiting page where their license key will appear once the webhook lands.
 */

const CAL_LINK = import.meta.env.VITE_CAL_LINK || "nhu-y-pham-aliana-afiwbr/thelyceum.site";
const CAL_NAMESPACE = import.meta.env.VITE_CAL_NAMESPACE || "thelyceum.site";

export default function ThankYou() {
  const [, navigate] = useLocation();
  useCalEmbed();

  const ref = new URLSearchParams(window.location.search).get("ref") ?? "";

  const goToWaiting = () => {
    navigate(`/waiting${ref ? `?ref=${ref}` : ""}`);
  };

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-teal/10 flex items-center justify-center">
          <Check className="w-7 h-7 text-teal" />
        </div>
        <h1 className="font-display text-2xl font-semibold text-foreground mb-2">
          Thank you for your trust.
        </h1>
        <p className="text-muted-foreground text-sm leading-relaxed mb-8">
          Your pre-order is confirmed. Grab 15 minutes with our founder to walk through
          your setup, or continue to your license key.
        </p>

        <Button
          size="lg"
          data-cal-link={CAL_LINK}
          data-cal-namespace={CAL_NAMESPACE}
          data-cal-config='{"layout":"month_view","useSlotsViewOnSmallScreen":"true"}'
          className="w-full bg-teal hover:bg-teal-dark text-white mb-3"
        >
          Book a call with the founder
        </Button>

        <button
          onClick={goToWaiting}
          className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors"
        >
          Skip — take me to my license key
        </button>
      </div>
    </div>
  );
}
