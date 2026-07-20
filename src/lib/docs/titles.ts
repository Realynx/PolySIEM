/** Remove a redundant parent-page prefix from an AI-authored child title. */
export function conciseChildTitle(title: string, parentTitle: string): string {
  const trimmedTitle = title.trim();
  const trimmedParent = parentTitle.trim();
  if (!trimmedTitle || !trimmedParent) return trimmedTitle;

  const separators = [" — ", " – ", " - ", ": ", " / "];
  for (const separator of separators) {
    const prefix = `${trimmedParent}${separator}`;
    if (trimmedTitle.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
      return trimmedTitle.slice(prefix.length).trim() || trimmedTitle;
    }
  }
  return trimmedTitle;
}
