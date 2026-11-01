'use strict';

// Works out role, company, location and salary from a job ad's HTML.
// Most job boards include a schema.org JobPosting block for Google Jobs, so that's tried
// first. If there isn't one, it falls back to the page's title and share tags.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', pound: '£', euro: '€', ndash: '–', mdash: '—' };

function decode(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

function clean(text) {
  if (text == null) return '';
  return decode(String(text).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// Every JobPosting in the page's JSON-LD blocks, wherever it's nested.
function findJobPostings(html) {
  const found = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const type = node['@type'];
    if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) found.push(node);
    if (node['@graph']) visit(node['@graph']);
  };
  for (const [, body] of blocks) {
    try {
      visit(JSON.parse(body.trim()));
    } catch {
      // Some sites ship broken JSON-LD. Skip it and try the next block.
    }
  }
  return found;
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function locationFrom(job) {
  const remote = String(job.jobLocationType || '').toUpperCase().includes('TELECOMMUTE');
  const places = (Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation]).filter(Boolean);
  const names = places.map((place) => {
    const address = place.address || place;
    if (typeof address === 'string') return clean(address);
    return clean(address.addressLocality || address.addressRegion || address.name || '');
  }).filter(Boolean);
  const place = [...new Set(names)].slice(0, 2).join(' / ');
  if (remote && place) return `Remote (${place})`;
  if (remote) {
    const country = clean(first(job.applicantLocationRequirements)?.name || '');
    return country ? `Remote (${country})` : 'Remote';
  }
  return place;
}

const SYMBOLS = { GBP: '£', USD: '$', EUR: '€' };

function money(n, symbol) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1000) {
    const k = value / 1000;
    return `${symbol}${Number.isInteger(k) ? k : k.toFixed(1)}k`;
  }
  return `${symbol}${value % 1 ? value.toFixed(2) : value}`;
}

function salaryFrom(job) {
  const base = first(job.baseSalary) || first(job.estimatedSalary);
  if (!base) return '';
  if (typeof base !== 'object') return clean(base);
  const symbol = SYMBOLS[base.currency] ?? (base.currency ? `${base.currency} ` : '');
  const v = base.value;
  let text = '';
  if (v && typeof v === 'object') {
    const lo = money(v.minValue, symbol);
    const hi = money(v.maxValue, symbol);
    text = lo && hi && lo !== hi ? `${lo}–${hi}` : lo || hi || money(v.value, symbol);
    const unit = String(v.unitText || '').toUpperCase();
    if (text && unit === 'HOUR') text += ' an hour';
    if (text && unit === 'DAY') text += ' a day';
  } else if (v != null) {
    text = money(v, symbol);
  }
  return text;
}

function meta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return clean(m[1]);
  }
  return '';
}

// Company name from a web address, e.g. careers.brightloop.co.uk → Brightloop.
function companyFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
  const boards = ['linkedin', 'indeed', 'reed', 'totaljobs', 'glassdoor', 'workable', 'greenhouse', 'lever', 'ashbyhq', 'smartrecruiters', 'teamtailor', 'bamboohr', 'workday', 'myworkdayjobs', 'otta', 'welcometothejungle', 'cv-library', 'guardianjobs', 'dribbble', 'behance'];
  const parts = host.replace(/^www\./, '').split('.');
  const skip = new Set(['careers', 'jobs', 'apply', 'join', 'work', 'co', 'com', 'org', 'uk', 'io', 'net', 'eu', 'boards', 'job-boards']);
  const name = parts.find((p) => !skip.has(p) && p.length > 1);
  if (!name || boards.includes(name)) return '';
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// Fallback for pages without JobPosting data. Handles the common title shapes:
// "Role at Company", "Role - Company", and LinkedIn's "Company hiring Role in Place".
function fromTitle(html, url) {
  const ogTitle = meta(html, 'og:title');
  const titleTag = clean((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const raw = (ogTitle || titleTag).replace(/\s*\|\s*(LinkedIn|Indeed.*|Glassdoor|Reed\.co\.uk|Totaljobs)$/i, '').trim();
  const out = { role: '', company: '', location: '' };
  if (!raw) return out;

  let m = raw.match(/^(.+?) hiring (.+?)(?: in (.+))?$/i);
  if (m) return { company: m[1].trim(), role: m[2].trim(), location: (m[3] || '').trim() };

  m = raw.match(/^(.+?) at (.+?)$/i);
  if (m) return { ...out, role: m[1].trim(), company: m[2].replace(/\s*[-–|].*$/, '').trim() };

  const parts = raw.split(/\s+[-–|]\s+/).map((s) => s.trim()).filter(Boolean);
  out.role = parts[0] || '';
  const site = meta(html, 'og:site_name');
  out.company = site || (parts.length > 1 ? parts[parts.length - 1] : '') || companyFromUrl(url);
  if (/careers|jobs/i.test(out.company) && parts.length > 2) out.company = parts[1];
  return out;
}

// Returns { role, company, location, salary, filled: [field names that were found] }.
function parseJobAd(html, url = '') {
  const result = { role: '', company: '', location: '', salary: '' };
  const job = findJobPostings(html || '')[0];
  if (job) {
    result.role = clean(job.title || job.name);
    const org = first(job.hiringOrganization);
    result.company = clean(typeof org === 'string' ? org : org?.name);
    result.location = locationFrom(job);
    result.salary = salaryFrom(job);
  }
  if (!result.role || !result.company) {
    const fallback = fromTitle(html || '', url);
    result.role ||= fallback.role;
    result.company ||= fallback.company;
    result.location ||= fallback.location;
  }
  result.company ||= companyFromUrl(url);
  result.filled = Object.keys(result).filter((k) => k !== 'filled' && result[k]);
  return result;
}

module.exports = { parseJobAd, findJobPostings, companyFromUrl, decode };
