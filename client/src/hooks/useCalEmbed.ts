import { useEffect } from "react";

declare global {
  interface Window {
    Cal?: any;
  }
}

const CAL_NAMESPACE = import.meta.env.VITE_CAL_NAMESPACE || "thelyceum.site";

/** Loads the Cal.com element-click embed script once and initializes the shared namespace. */
export function useCalEmbed() {
  useEffect(() => {
    if (window.Cal) return;

    (function (C: any, A: string, L: string) {
      let p = function (a: any, ar: any) {
        a.q.push(ar);
      };
      let d = C.document;
      C.Cal =
        C.Cal ||
        function (...args: any[]) {
          const cal = C.Cal;
          const ar = args;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            d.head.appendChild(d.createElement("script")).src = A;
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api: any = function (...apiArgs: any[]) {
              p(api, apiArgs);
            };
            const namespace = ar[1];
            api.q = api.q || [];
            if (typeof namespace === "string") {
              cal.ns[namespace] = cal.ns[namespace] || api;
              p(cal.ns[namespace], ar);
              p(cal, ["initNamespace", namespace]);
            } else p(cal, ar);
            return;
          }
          p(cal, ar);
        };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    window.Cal("init", CAL_NAMESPACE, { origin: "https://app.cal.com" });
    window.Cal.ns[CAL_NAMESPACE]("ui", { hideEventTypeDetails: false, layout: "month_view" });
  }, []);
}
