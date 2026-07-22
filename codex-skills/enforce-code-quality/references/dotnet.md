# .NET cyclomatic-complexity gate

ESLint does not analyze C#. Use the built-in .NET code-quality rule CA1502 and set its method threshold to 15.

## Configuration

Create `dotnet/CodeMetricsConfig.txt`:

```text
CA1502: 15
```

Add or extend `dotnet/Directory.Build.props`:

```xml
<Project>
  <PropertyGroup>
    <EnableNETAnalyzers>true</EnableNETAnalyzers>
  </PropertyGroup>
  <ItemGroup>
    <AdditionalFiles Include="$(MSBuildThisFileDirectory)CodeMetricsConfig.txt" />
  </ItemGroup>
</Project>
```

Add or extend `dotnet/.editorconfig`:

```ini
[*.cs]
dotnet_diagnostic.CA1502.severity = error
```

When a repository already has shared props or `.editorconfig`, merge these settings instead of replacing the files. Confirm generated code is excluded by the repository's established analyzer conventions rather than adding broad exclusions.

Microsoft documents CA1502 as cyclomatic complexity for C# and Visual Basic, with the threshold supplied through an AdditionalFiles configuration: https://learn.microsoft.com/dotnet/fundamentals/code-analysis/quality-rules/ca1502

## Commands

```powershell
dotnet build dotnet/FinBroker.sln --configuration Release
dotnet test dotnet/FinBroker.sln --configuration Release --no-build
```

For another repository, replace the solution path after discovering its structure.

## Refactoring guidance

- Extract pure validation and mapping methods.
- Use early returns for invalid or terminal cases.
- Separate I/O orchestration from domain decisions.
- Prefer small strategy implementations over growing provider switches.
- Preserve cancellation, logging, transaction, and exception semantics.
- Add characterization tests before changing branch-heavy financial, security, or compliance logic.

Do not weaken CA1502 severity, raise the threshold, or exclude production projects to obtain a clean build.

