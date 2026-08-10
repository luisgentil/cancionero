import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const canciones = defineCollection({
  loader: glob({ pattern: '**/*.json', base: './src/content/canciones' }),
  schema: z.object({
    titulo: z.string(),
    autor: z.string(),
    genero: z.string().optional(),
    tema: z.string().optional(),
    tono: z.string().optional(),
    letra: z.string(),
  }),
});

export const collections = { canciones };