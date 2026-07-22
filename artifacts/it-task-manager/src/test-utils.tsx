/**
 * Shared test utilities for react-testing-library renders.
 *
 * Provides a `renderWithProviders` function that wraps the component under
 * test with all the global context providers (I18nextProvider,
 * TerminologyProvider, QueryClientProvider) so individual test files don't
 * need to repeat the setup.
 */

import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { TerminologyProvider } from "@/context/terminology-context";
import i18n from "@/i18n";

interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  queryClient?: QueryClient;
}

function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

export function renderWithProviders(
  ui: React.ReactElement,
  { queryClient = makeQueryClient(), ...options }: RenderWithProvidersOptions = {},
) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <TerminologyProvider>{children}</TerminologyProvider>
        </QueryClientProvider>
      </I18nextProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}

export { makeQueryClient };
