import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const tags = [
    ["viaggio", "#6D5DFB"],
    ["estate", "#E5A348"],
    ["ritratto", "#D95D57"],
    ["architettura", "#4B7C87"],
    ["portfolio", "#36A27A"],
    ["da montare", "#B867CF"]
  ] as const;

  await Promise.all(
    tags.map(([name, color]) =>
      prisma.tag.upsert({
        where: { name },
        update: { color },
        create: { name, color }
      })
    )
  );

  await Promise.all(
    ["Sofia", "Luca", "Elena", "Jonas"].map((name) =>
      prisma.person.upsert({
        where: { name },
        update: {},
        create: { name }
      })
    )
  );

  await Promise.all(
    [
      ["Da catalogare", "Nuovi media in attesa di classificazione", "#6D5DFB"],
      ["Australia 2026", "Roadtrip lungo la costa occidentale", "#2A9D8F"],
      ["Portraits", "Ritratti editoriali e test luce", "#D95D57"],
      ["Urban studies", "Forme, città e architettura", "#4B7C87"]
    ].map(([name, description, accent]) =>
      prisma.group.upsert({
        where: { name },
        update: { description, accent },
        create: { name, description, accent }
      })
    )
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
