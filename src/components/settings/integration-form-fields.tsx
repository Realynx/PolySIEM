"use client";

import type { Dispatch, SetStateAction } from "react";
import type { FormState } from "./integration-form-model";
import { IntegrationCredentialsFields } from "./integration-fields/credentials-fields";
import { EdgeNatFields } from "./integration-fields/edge-nat-fields";
import { NetworkProviderFields } from "./integration-fields/network-provider-fields";
import { ObservabilityProviderFields } from "./integration-fields/observability-provider-fields";
import { ResearchProviderFields } from "./integration-fields/research-provider-fields";

interface IntegrationSpecificFieldsProps {
  form: FormState;
  setForm: Dispatch<SetStateAction<FormState>>;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  isEdit: boolean;
  showCredentials: boolean;
}

export function IntegrationSpecificFields({
  form,
  setForm,
  set,
  isEdit,
  showCredentials,
}: IntegrationSpecificFieldsProps) {
  return (
    <>
      <IntegrationCredentialsFields
        form={form}
        set={set}
        isEdit={isEdit}
        showCredentials={showCredentials}
      />
      <EdgeNatFields form={form} setForm={setForm} set={set} isEdit={isEdit} />
      <NetworkProviderFields form={form} set={set} />
      <ResearchProviderFields form={form} set={set} />
      <ObservabilityProviderFields form={form} set={set} />
    </>
  );
}
