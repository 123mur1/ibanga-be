import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Auth users are created through register. Do not seed demo accounts.
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
