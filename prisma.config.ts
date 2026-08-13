import 'dotenv/config'
import { defineConfig } from 'prisma/config'
import { databaseUrl } from './src/lib/db/url'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl(),
  },
})
