import {
  createSocialCard,
  SOCIAL_CARD_ALT,
  SOCIAL_CARD_SIZE,
} from "@/lib/social-card";

export const alt = SOCIAL_CARD_ALT;
export const size = SOCIAL_CARD_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default function OpenGraphImage() {
  return createSocialCard();
}
