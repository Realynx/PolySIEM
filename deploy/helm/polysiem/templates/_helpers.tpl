{{/* Expand the chart name. */}}
{{- define "polysiem.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Create a release-qualified name. */}}
{{- define "polysiem.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/* Chart label value. */}}
{{- define "polysiem.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Labels shared by all chart resources. */}}
{{- define "polysiem.commonLabels" -}}
helm.sh/chart: {{ include "polysiem.chart" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Application metadata labels. */}}
{{- define "polysiem.labels" -}}
{{ include "polysiem.commonLabels" . }}
{{ include "polysiem.selectorLabels" . }}
{{- end }}

{{/* Application selector labels. */}}
{{- define "polysiem.selectorLabels" -}}
app.kubernetes.io/name: {{ include "polysiem.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: application
{{- end }}

{{/* PostgreSQL selector labels. */}}
{{- define "polysiem.postgresqlSelectorLabels" -}}
app.kubernetes.io/name: {{ include "polysiem.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/* PostgreSQL metadata labels. */}}
{{- define "polysiem.postgresqlLabels" -}}
{{ include "polysiem.commonLabels" . }}
{{ include "polysiem.postgresqlSelectorLabels" . }}
{{- end }}

{{/* Service account name. */}}
{{- define "polysiem.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "polysiem.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Secret containing the application and database credentials. */}}
{{- define "polysiem.secretName" -}}
{{- default (include "polysiem.fullname" .) .Values.secrets.existingSecret }}
{{- end }}

{{/* Bundled PostgreSQL resource name. */}}
{{- define "polysiem.postgresqlFullname" -}}
{{- printf "%s-postgresql" (include "polysiem.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Application PVC name. */}}
{{- define "polysiem.persistenceClaimName" -}}
{{- default (include "polysiem.fullname" .) .Values.persistence.existingClaim }}
{{- end }}

{{/* Restart the app when chart-managed Secret inputs change. */}}
{{- define "polysiem.appSecretInputsChecksum" -}}
{{- printf "%s|%s|%s|%s|%s|%s|%s|%s|%v|%v" .Values.secrets.existingSecret .Values.secrets.keys.appSecret .Values.secrets.keys.databaseUrl .Values.config.appSecret .Values.config.databaseUrl .Values.postgresql.auth.username .Values.postgresql.auth.database .Values.postgresql.auth.password .Values.postgresql.enabled .Values.postgresql.service.port | sha256sum }}
{{- end }}

{{/* Existing Secret contents are opaque to Helm; rolloutRevision is manual. */}}
{{- define "polysiem.rolloutChecksum" -}}
{{- printf "%s|%s" (include "polysiem.appSecretInputsChecksum" .) .Values.rolloutRevision | sha256sum }}
{{- end }}

{{/* Restart bundled PostgreSQL only when its Secret inputs change. */}}
{{- define "polysiem.postgresqlRolloutChecksum" -}}
{{- printf "%s|%s|%s|%s|%s" .Values.secrets.existingSecret .Values.postgresql.auth.username .Values.postgresql.auth.database .Values.postgresql.auth.password .Values.rolloutRevision | sha256sum }}
{{- end }}
