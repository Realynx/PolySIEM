# FinBrokerCrm profile

Repository: `C:\Users\poofi\source\repos\FinBrokerCrm`

Treat this as a mixed Next.js/TypeScript and .NET 10 repository.

## JavaScript and TypeScript

Add `codefactor:check` and `quality:check` to `package.json` using the JS/TS reference. Preserve the existing scripts and ESLint flat configuration.

Required verification:

```powershell
npm run typecheck
npm run lint -- --max-warnings=0
npm run codefactor:check
npm test
npm run build
```

Run `npm run e2e` only when the required application and database environment are available.

## .NET

The solution is `dotnet/FinBroker.sln` with production and test projects. No repository-level C# complexity analyzer was configured when this profile was created.

Configure CA1502 at 15 using the .NET reference before claiming full C# CodeFactor parity. Then run:

```powershell
dotnet build dotnet/FinBroker.sln --configuration Release
dotnet test dotnet/FinBroker.sln --configuration Release --no-build
```

Financial suitability, supervision, recordkeeping, and immutable-storage code are high-risk. Add characterization tests before refactoring branch-heavy behavior, and preserve audit, transaction, retention, and authorization semantics exactly.

