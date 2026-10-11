import "../config/env";
import { checkDatabase, prisma } from "../db/prisma";

async function main(): Promise<void> {
  const status = await checkDatabase();
  console.log(JSON.stringify(status));

  await prisma.$disconnect();

  if (status.database !== "connected") {
    console.error(
      "Database connectivity check failed. Verify DATABASE_URL points to a running PostgreSQL instance."
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Database connectivity check failed:", err);
  process.exit(1);
});
