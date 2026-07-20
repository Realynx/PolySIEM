/**
 * Development seed intentionally creates no users or credentials. The first
 * browser visit launches the installer, where the operator chooses the initial
 * administrator username and password.
 */
async function main() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_SEED !== "true"
  ) {
    throw new Error(
      "Refusing to seed in production (set ALLOW_SEED=true to override)",
    );
  }

  console.log("Seed complete: no default accounts were created.");
  console.log("Open PolySIEM in a browser to run the first-install wizard.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
