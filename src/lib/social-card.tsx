import { ImageResponse } from "next/og";
import { getSitePresentation } from "@/lib/site-presentation";

export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;
export const SOCIAL_CARD_ALT =
  "PolySIEM — self-hosted homelab documentation and security dashboard";

/** Render the shared Open Graph and Twitter/X preview in the README brand style. */
export function createSocialCard(): ImageResponse {
  const site = getSitePresentation();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          color: "#f8fafc",
          backgroundColor: "#0b1226",
          backgroundImage:
            "linear-gradient(rgba(129,140,248,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(129,140,248,.07) 1px, transparent 1px), linear-gradient(135deg, #0b1226 0%, #111936 55%, #171738 100%)",
          backgroundSize: "44px 44px, 44px 44px, 100% 100%",
          fontFamily: "Arial, sans-serif",
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 22,
            display: "flex",
            border: "2px solid rgba(129, 140, 248, .28)",
            borderRadius: 34,
          }}
        />

        <div
          style={{
            display: "flex",
            width: 142,
            height: 142,
            padding: 25,
            borderRadius: 34,
            background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            boxShadow: "0 18px 42px rgba(2, 6, 23, .55)",
            flexDirection: "column",
            gap: 12,
          }}
        >
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: "#fff" }} />
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "rgba(255,255,255,.68)",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 12,
                background: "rgba(255,255,255,.68)",
              }}
            />
            <div
              style={{
                width: 40,
                height: 40,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  width: 8,
                  height: 36,
                  borderRadius: 999,
                  background: "#fff",
                  transform: "rotate(45deg)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  width: 8,
                  height: 36,
                  borderRadius: 999,
                  background: "#fff",
                  transform: "rotate(-45deg)",
                }}
              />
            </div>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: 28,
            fontSize: 70,
            fontWeight: 800,
            letterSpacing: 5,
          }}
        >
          POLYSIEM
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 12,
            color: "#c7d2fe",
            fontSize: 24,
            fontWeight: 600,
            letterSpacing: 5,
          }}
        >
          HOMELAB INTELLIGENCE, DOCUMENTED
        </div>
        <div
          style={{
            display: "flex",
            marginTop: 38,
            padding: "10px 20px",
            border: "1px solid rgba(165, 180, 252, .34)",
            borderRadius: 999,
            color: site.isPublicDemo ? "#ddd6fe" : "#bfdbfe",
            background: site.isPublicDemo
              ? "rgba(124, 58, 237, .2)"
              : "rgba(37, 99, 235, .16)",
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: 2,
          }}
        >
          {site.cardLabel}
        </div>
      </div>
    ),
    SOCIAL_CARD_SIZE,
  );
}
