import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const canciones = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/canciones' }),
  schema: z.object({
    titulo: z.string().optional(),
    autor: z.string().optional(),
    seccion: z.array(z.string()).optional(),
    tono: z.string().optional(),
    youtube: z.string().optional(),
    pdf: z.string().optional(),
    historia: z.string().optional(),
    fecha: z.coerce.date().optional(),
    descripcion: z.string().optional(),
    palabrasClave: z.array(z.string()).optional(),
    urlAnterior: z.string().url().optional(),
  }),
});

export const collections = { canciones };