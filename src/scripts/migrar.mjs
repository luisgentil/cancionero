#!/usr/bin/env node
/**
 * Migración del cancionero HTML (Neocities) a archivos Markdown
 * para el sitio Astro.
 *
 * Uso:
 *   node migrar.mjs --input ./html --index ./html/cantos-de-misa.html --out ./salida
 *
 * --input  carpeta con los archivos .html de canciones
 * --index  archivo HTML índice que agrupa canciones por sección litúrgica
 * --out    carpeta donde se escriben los .md resultantes
 */

import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

// ---------- Utilidades de línea de comandos ----------

function leerArgs() {
  const args = process.argv.slice(2);
  const opts = { input: './html', index: null, out: './salida' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') opts.input = args[++i];
    if (args[i] === '--index') opts.index = args[++i];
    if (args[i] === '--out') opts.out = args[++i];
  }
  return opts;
}

// ---------- Conversión de notación de acordes ----------

const NOTE_MAP = {
  do: 'C', re: 'D', mi: 'E', fa: 'F', sol: 'G', la: 'A', si: 'B',
};
const NOTE_NAMES = Object.keys(NOTE_MAP).sort((a, b) => b.length - a.length);

const CHORD_TOKEN_RE = new RegExp(
  `^(${NOTE_NAMES.join('|')})(#|b)?(m)?(7|9|11|13|6|sus2|sus4|dim|aum|maj7)?$`,
  'i'
);

// Los acordes opcionales se escriben a veces entre paréntesis: "(mim)"
const limpiarToken = token => token.replace(/^\(+|\)+$/g, '');

function esTokenAcorde(token) {
  return CHORD_TOKEN_RE.test(limpiarToken(token));
}

function traducirAcorde(token) {
  const m = limpiarToken(token).match(CHORD_TOKEN_RE);
  if (!m) return token;
  const nota = NOTE_MAP[m[1].toLowerCase()];
  const alt = m[2] || '';
  const menor = m[3] ? 'm' : '';
  const ext = m[4] || '';
  return `${nota}${alt}${menor}${ext}`;
}

// Corrección 1: unir un acorde y su extensión cuando quedaron separados
// por un espaciado ancho, ej. "MI     7" -> "MI7"
function normalizarEspaciado(linea) {
  const re = new RegExp(
    `\\b(${NOTE_NAMES.join('|')})(#|b)?(m)?\\s{2,}(7|9)\\b`,
    'gi'
  );
  return linea.replace(re, (_, nota, alt = '', menor = '', ext) => `${nota}${alt}${menor}${ext}`);
}

function esLineaDeAcordes(linea) {
  const tokens = linea.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const tokensReales = tokens.filter(t => !['/', '-', '(', ')', '*'].includes(t));
  if (tokensReales.length === 0) return false;
  return tokensReales.every(esTokenAcorde);
}

function posicionesDeTokens(linea) {
  const resultado = [];
  let cursor = 0;
  for (const token of linea.split(/\s+/).filter(Boolean)) {
    const col = linea.indexOf(token, cursor);
    cursor = col + token.length;
    if (['/', '-', '(', ')', '*'].includes(token)) continue;
    resultado.push([col, token]);
  }
  return resultado;
}

function fusionarAcordesLetra(lineaAcordes, lineaLetra) {
  const originalLen = lineaLetra.length;
  const posiciones = posicionesDeTokens(lineaAcordes);

  // Acordes que caen dentro del texto: se insertan de derecha a izquierda
  // para no desplazar columnas ya usadas.
  const dentro = posiciones.filter(([col]) => col < originalLen).sort((a, b) => b[0] - a[0]);
  // Acordes "sobrantes" más allá del final de la letra (ej. acordes de
  // cierre tras la última palabra): se añaden juntos, en su orden original,
  // sin tocar lo ya insertado dentro del texto.
  const fuera = posiciones.filter(([col]) => col >= originalLen).sort((a, b) => a[0] - b[0]);

  let letra = lineaLetra;
  for (const [col, token] of dentro) {
    letra = letra.slice(0, col) + `[${traducirAcorde(token)}]` + letra.slice(col);
  }
  if (fuera.length) {
    letra += ' ' + fuera.map(([, token]) => `[${traducirAcorde(token)}]`).join('');
  }
  return letra;
}

// Corrección 2 y 3: comentarios ChordPro seguros, sin llaves sueltas de {Bis: ...}
function procesarPre(textoPre) {
  // Los corchetes [ ] tienen significado especial en ChordPro (marcan un
  // acorde). Si el texto original ya traía corchetes con otro sentido
  // (ej. "[SOL - RE - mim]" como anotación de acordes alternativos), hay
  // que neutralizarlos ANTES de insertar los nuestros, o colisionarían.
  const sinCorchetesOriginales = textoPre.replace(/\[/g, '(').replace(/\]/g, ')');
  const lineas = sinCorchetesOriginales.replace(/\r\n/g, '\n').split('\n').map(normalizarEspaciado);

  while (lineas.length && lineas[0].trim() === '') lineas.shift();
  while (lineas.length && lineas[lineas.length - 1].trim() === '') lineas.pop();

  const salida = [];
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    const trimmed = linea.trim();

    // Marcador de repetición {Bis: ... } -> texto seguro, sin llaves ChordPro
    if (/^\{Bis:?\s*$/i.test(trimmed)) {
      salida.push('(Bis)');
      i++;
      continue;
    }
    if (trimmed === '}') {
      i++;
      continue;
    }

    if (trimmed === '') {
      salida.push('');
      i++;
      continue;
    }

    if (esLineaDeAcordes(linea)) {
      const siguiente = lineas[i + 1];
      if (siguiente !== undefined && siguiente.trim() !== '' && !esLineaDeAcordes(siguiente)) {
        salida.push(fusionarAcordesLetra(linea, siguiente));
        i += 2;
      } else {
        // Acordes sueltos sin letra debajo (ej. una intro) -> comentario ChordPro real
        salida.push(`{comment: ${trimmed}}`);
        i++;
      }
      continue;
    }

    salida.push(linea.replace(/\s+$/, ''));
    i++;
  }
  return salida.join('\n').trim();
}

// ---------- Extracción de datos de cada página ----------

function esRedireccion(html) {
  return /<meta[^>]+http-equiv=["']refresh["']/i.test(html);
}

function extraerYoutube($) {
  const iframe = $('iframe[src*="youtube.com/embed"]').first().attr('src');
  if (iframe) {
    const id = iframe.match(/embed\/([\w-]+)/)?.[1];
    if (id) return `https://www.youtube.com/watch?v=${id}`;
  }
  const link = $('a[href*="youtu.be"], a[href*="youtube.com"]')
    .filter((_, el) => !!$(el).attr('href')?.trim())
    .first()
    .attr('href');
  return link || undefined;
}

function extraerPdf($) {
  const link = $('a[href*="drive.google.com"], a[href$=".pdf"]').first().attr('href');
  return link || undefined;
}

function extraerHistoria($) {
  let texto;
  $('h2').each((_, el) => {
    if (texto) return;
    const candidato = $(el).nextAll('p').first().text().trim();
    if (candidato) texto = candidato.replace(/\s+/g, ' ');
  });
  return texto;
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Acepta "02 noviembre 2019 00:00:00 GMT+1", "Thu, 14 March 2019 ...", etc.
function parsearFecha(texto) {
  if (!texto) return undefined;
  const m = texto.match(/(\d{1,2})\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+(\d{4})/);
  if (!m) return undefined;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return undefined;
  const pad = n => String(n).padStart(2, '0');
  return `${m[3]}-${pad(mes)}-${pad(m[1])}`;
}

function extraerMeta($) {
  const meta = nombre => $(`meta[name="${nombre}" i]`).attr('content')?.trim() || undefined;

  const keywords = meta('keywords')
    ?.split(',')
    .map(k => k.trim())
    .filter(Boolean);

  return {
    descripcion: meta('description'),
    palabrasClave: keywords && keywords.length ? [...new Set(keywords)] : undefined,
    fecha: parsearFecha(meta('DateCreated')),
    urlAnterior: $('link[rel="canonical"]').attr('href')?.trim() || undefined,
  };
}

function extraerDatos(rutaArchivo) {
  const html = fs.readFileSync(rutaArchivo, 'utf-8');
  if (esRedireccion(html)) return { redireccion: true };

  const $ = cheerio.load(html);

  const titulo = $('h1').first().text().trim() || undefined;

  let autor;
  $('h4').each((_, el) => {
    const texto = $(el).text();
    if (/autor:/i.test(texto)) autor = texto.replace(/autor:/i, '').trim();
  });

  const pre = $('pre').first();
  const letra = pre.length ? procesarPre(pre.text()) : '';

  return {
    redireccion: false,
    titulo,
    autor,
    letra,
    youtube: extraerYoutube($),
    pdf: extraerPdf($),
    historia: extraerHistoria($),
    ...extraerMeta($),
  };
}

// ---------- Índice de secciones litúrgicas ----------

function extraerMapaSecciones(rutaIndice) {
  const mapa = new Map(); // filename -> Set(secciones)
  if (!rutaIndice) return mapa;

  const html = fs.readFileSync(rutaIndice, 'utf-8');
  const $ = cheerio.load(html);

  let seccionActual = null;
  $('h3, li').each((_, el) => {
    const tag = el.tagName?.toLowerCase();
    if (tag === 'h3') {
      seccionActual = $(el).text().trim();
      return;
    }
    if (tag === 'li' && seccionActual) {
      const href = $(el).find('a').first().attr('href');
      if (!href) return;
      const archivo = path.basename(href);
      if (!mapa.has(archivo)) mapa.set(archivo, new Set());
      mapa.get(archivo).add(seccionActual);
    }
  });

  return mapa;
}

// ---------- Generación de frontmatter YAML ----------

function escaparYaml(valor) {
  return `"${String(valor).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function generarMarkdown(datos) {
  const lineas = ['---'];
  if (datos.titulo) lineas.push(`titulo: ${escaparYaml(datos.titulo)}`);
  if (datos.autor) lineas.push(`autor: ${escaparYaml(datos.autor)}`);
  if (datos.secciones && datos.secciones.length) {
    lineas.push('seccion:');
    for (const s of datos.secciones) lineas.push(`  - ${escaparYaml(s)}`);
  }
  if (datos.youtube) lineas.push(`youtube: ${escaparYaml(datos.youtube)}`);
  if (datos.pdf) lineas.push(`pdf: ${escaparYaml(datos.pdf)}`);
  if (datos.historia) lineas.push(`historia: ${escaparYaml(datos.historia)}`);
  if (datos.fecha) lineas.push(`fecha: ${datos.fecha}`);
  if (datos.descripcion) lineas.push(`descripcion: ${escaparYaml(datos.descripcion)}`);
  if (datos.palabrasClave?.length) {
    lineas.push('palabrasClave:');
    for (const k of datos.palabrasClave) lineas.push(`  - ${escaparYaml(k)}`);
  }
  if (datos.urlAnterior) lineas.push(`urlAnterior: ${escaparYaml(datos.urlAnterior)}`);
  lineas.push('---');
  lineas.push(datos.letra || '');
  return lineas.join('\n') + '\n';
}

// ---------- Programa principal ----------

function main() {
  const opts = leerArgs();
  const mapaSecciones = extraerMapaSecciones(opts.index);

  fs.mkdirSync(opts.out, { recursive: true });

  const archivos = fs.readdirSync(opts.input).filter(f => f.endsWith('.html'));
  const resumen = { migrados: 0, omitidos: [], sinSeccion: [] };

  for (const archivo of archivos) {
    if (opts.index && path.resolve(opts.input, archivo) === path.resolve(opts.index)) continue;

    const rutaCompleta = path.join(opts.input, archivo);
    const datos = extraerDatos(rutaCompleta);

    if (datos.redireccion) {
      resumen.omitidos.push({ archivo, motivo: 'redirección' });
      continue;
    }
    if (!datos.titulo || !datos.letra) {
      resumen.omitidos.push({ archivo, motivo: 'sin título o sin <pre> de letra' });
      continue;
    }

    const secciones = [...(mapaSecciones.get(archivo) || [])];
    if (secciones.length === 0) resumen.sinSeccion.push(archivo);

    const md = generarMarkdown({ ...datos, secciones });
    const nombreSalida = archivo.replace(/\.html?$/, '.md');
    fs.writeFileSync(path.join(opts.out, nombreSalida), md, 'utf-8');
    resumen.migrados++;
  }

  console.log(`\nMigrados: ${resumen.migrados}`);
  if (resumen.omitidos.length) {
    console.log(`\nOmitidos (${resumen.omitidos.length}):`);
    for (const o of resumen.omitidos) console.log(`  - ${o.archivo}: ${o.motivo}`);
  }
  if (resumen.sinSeccion.length) {
    console.log(`\nSin sección asignada en el índice (${resumen.sinSeccion.length}):`);
    for (const a of resumen.sinSeccion) console.log(`  - ${a}`);
  }
}

main();

// node scripts/migrar.mjs --input C:\Users\VORPC\Documents\Programar\cancionero\resources\canciones\migrar --index C:\Users\VORPC\Documents\Programar\cancionero\resources\pages/cantos-de-misa.html --out content/canciones