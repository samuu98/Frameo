#!/bin/sh
set -eu

echo "Preparing Frameo database..."
prisma db push --skip-generate

if [ "${FRAMEO_SEED_DEMO:-false}" = "true" ]; then
  echo "Loading optional demo data..."
  tsx prisma/seed.ts
fi

echo "Starting Frameo on port ${PORT:-3000}..."
node -e 'const {PrismaClient}=require("@prisma/client"); const db=new PrismaClient(); db.editProject.updateMany({where:{state:{in:["RUNNING","PENDING"]}},data:{state:"FAILED",error:"Operazione interrotta dal riavvio del server. Avvia un nuovo montaggio dalle sorgenti originali."}}).finally(()=>db.$disconnect()).catch(error=>{console.error(error);process.exitCode=1;});'
exec node server.js
