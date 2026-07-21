import type { Dispatch, SetStateAction } from "react";
import type { FormState } from "../integration-form-model";

export type IntegrationFieldSetter = <K extends keyof FormState>(key: K, value: FormState[K]) => void;

export interface IntegrationFieldsProps {
  form: FormState;
  set: IntegrationFieldSetter;
}

export interface IntegrationCredentialsFieldsProps extends IntegrationFieldsProps {
  isEdit: boolean;
  showCredentials: boolean;
}

export interface IntegrationStateFieldsProps extends IntegrationFieldsProps {
  setForm: Dispatch<SetStateAction<FormState>>;
  isEdit: boolean;
}
