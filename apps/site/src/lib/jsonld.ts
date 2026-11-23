// JSON-LD builders (schema.org) and a serializer that is safe inside <script type="application/ld+json">.

export type JsonLd = Readonly<Record<string, unknown>>;

// Escapes everything that could end the script element or confuse an HTML parser.
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export interface Crumb {
  readonly name: string;
  readonly url: string;
}

export function breadcrumbList(crumbs: readonly Crumb[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, i) => ({ '@type': 'ListItem', position: i + 1, name: crumb.name, item: crumb.url })),
  };
}

export interface QA {
  readonly q: string;
  readonly a: string;
}

// Only for FAQs that are shown in full on the same page.
export function faqPage(url: string, items: readonly QA[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    url,
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export interface Publisher {
  readonly name: string;
  readonly url: string;
  readonly logo: string;
}

function organization(p: Publisher): JsonLd {
  return { '@type': 'Organization', name: p.name, url: p.url, logo: { '@type': 'ImageObject', url: p.logo } };
}

export interface ArticleInput {
  readonly url: string;
  readonly headline: string;
  readonly description: string;
  readonly image: string;
  readonly published: string;
  readonly modified: string;
  readonly section: string;
  readonly isPartOf: string;
  readonly publisher: Publisher;
  readonly citations: readonly { readonly name: string; readonly url: string }[];
  readonly about: readonly string[];
}

export function article(input: ArticleInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': `${input.url}#article`,
    mainEntityOfPage: input.url,
    url: input.url,
    headline: input.headline,
    description: input.description,
    image: input.image,
    datePublished: input.published,
    dateModified: input.modified,
    inLanguage: 'en',
    articleSection: input.section,
    isAccessibleForFree: true,
    isPartOf: { '@type': 'CollectionPage', '@id': input.isPartOf },
    author: organization(input.publisher),
    publisher: organization(input.publisher),
    about: input.about.map((name) => ({ '@type': 'Thing', name })),
    citation: input.citations.map((c) => ({ '@type': 'CreativeWork', name: c.name, url: c.url })),
  };
}

export function website(url: string, name: string, description: string): JsonLd {
  return { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${url}#website`, url, name, description, inLanguage: 'en' };
}

export interface GameInput {
  readonly url: string;
  readonly playUrl: string;
  readonly name: string;
  readonly description: string;
  readonly image: string;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly publisher: Publisher;
}

export function videoGame(input: GameInput): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    '@id': `${input.url}#game`,
    url: input.url,
    name: input.name,
    description: input.description,
    image: input.image,
    genre: ['Social deduction', 'Educational'],
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any',
    playMode: 'MultiPlayer',
    numberOfPlayers: { '@type': 'QuantitativeValue', minValue: input.minPlayers, maxValue: input.maxPlayers },
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: 0, priceCurrency: 'USD', url: input.playUrl },
    publisher: organization(input.publisher),
    inLanguage: 'en',
  };
}

export function collectionPage(url: string, name: string, description: string, parts: readonly Crumb[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    '@id': url,
    url,
    name,
    description,
    inLanguage: 'en',
    hasPart: parts.map((p) => ({ '@type': 'Article', headline: p.name, url: p.url })),
  };
}
