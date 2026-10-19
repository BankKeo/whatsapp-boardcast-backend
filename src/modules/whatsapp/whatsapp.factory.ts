/**
 * Provider factory.
 *
 * Chooses the Meta provider only when credentials are actually configured;
 * otherwise the mock provider runs and the whole integration is labelled as
 * simulated (docs/starter-project.md §6).
 */

import { env, whatsappIsSimulated } from "../../config/env";
import { MockWhatsAppProvider } from "./providers/mock.provider";
import { MetaWhatsAppProvider } from "./providers/meta.provider";
import type { WhatsAppProvider } from "./whatsapp.types";

let provider: WhatsAppProvider | null = null;

export function getWhatsAppProvider(): WhatsAppProvider {
  if (provider) return provider;
  // Provider selection is explicit, but mock is forced when credentials are absent.
  provider = env.WHATSAPP_PROVIDER === "meta" && !whatsappIsSimulated
    ? new MetaWhatsAppProvider()
    : new MockWhatsAppProvider();
  return provider;
}

/** Test seam — allows a fake provider to be injected. */
export function setWhatsAppProvider(next: WhatsAppProvider | null): void {
  provider = next;
}
