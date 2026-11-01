'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseJobAd, companyFromUrl, decode } = require('../lib/jobad');

const ld = (obj) => `<html><head><script type="application/ld+json">${JSON.stringify(obj)}</script></head></html>`;

test('reads a schema.org JobPosting', () => {
  const ad = parseJobAd(ld({
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: 'Product Designer',
    hiringOrganization: { '@type': 'Organization', name: 'Brightloop' },
    jobLocation: { '@type': 'Place', address: { addressLocality: 'Leeds', addressCountry: 'GB' } },
    baseSalary: { '@type': 'MonetaryAmount', currency: 'GBP', value: { minValue: 45000, maxValue: 55000, unitText: 'YEAR' } },
  }));
  assert.deepEqual(ad, { role: 'Product Designer', company: 'Brightloop', location: 'Leeds', salary: '£45k–£55k', filled: ['role', 'company', 'location', 'salary'] });
});

test('marks remote jobs, with the country where given', () => {
  const ad = parseJobAd(ld({
    '@type': 'JobPosting', title: 'UX Designer', hiringOrganization: 'Halcyon',
    jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: { '@type': 'Country', name: 'UK' },
  }));
  assert.equal(ad.location, 'Remote (UK)');
  assert.equal(ad.company, 'Halcyon');
});

test('finds a JobPosting inside @graph and skips broken JSON-LD', () => {
  const html = '<script type="application/ld+json">{ broken</script>'
    + ld({ '@graph': [{ '@type': 'WebPage' }, { '@type': 'JobPosting', title: 'UI Designer', hiringOrganization: { name: 'Kestrel' } }] });
  const ad = parseJobAd(html);
  assert.equal(ad.role, 'UI Designer');
  assert.equal(ad.company, 'Kestrel');
});

test('hourly and single-value salaries', () => {
  const hourly = parseJobAd(ld({ '@type': 'JobPosting', title: 'x', baseSalary: { currency: 'GBP', value: { value: 25, unitText: 'HOUR' } } }));
  assert.equal(hourly.salary, '£25 an hour');
  const single = parseJobAd(ld({ '@type': 'JobPosting', title: 'x', baseSalary: { currency: 'USD', value: 80000 } }));
  assert.equal(single.salary, '$80k');
});

test('decodes entities and strips tags from titles', () => {
  const ad = parseJobAd(ld({ '@type': 'JobPosting', title: 'Brand &amp; Web <b>Designer</b>', hiringOrganization: { name: 'Moss &#38; Co' } }));
  assert.equal(ad.role, 'Brand & Web Designer');
  assert.equal(ad.company, 'Moss & Co');
});

test('falls back to LinkedIn-style share titles', () => {
  const html = '<meta property="og:title" content="Tidepool hiring Digital Designer in Manchester, England, United Kingdom | LinkedIn">';
  const ad = parseJobAd(html, 'https://www.linkedin.com/jobs/view/123');
  assert.equal(ad.company, 'Tidepool');
  assert.equal(ad.role, 'Digital Designer');
  assert.equal(ad.location, 'Manchester, England, United Kingdom');
});

test('falls back to "Role at Company" and "Role - Company" titles', () => {
  assert.equal(parseJobAd('<title>Visual Designer at Northwind Studio</title>').company, 'Northwind Studio');
  const ad = parseJobAd('<title>Senior Designer - Fernway Travel</title>');
  assert.equal(ad.role, 'Senior Designer');
  assert.equal(ad.company, 'Fernway Travel');
});

test('uses the web address for the company when nothing else says', () => {
  const ad = parseJobAd('<title>Product Designer</title>', 'https://careers.orbitlabs.co.uk/jobs/42');
  assert.equal(ad.role, 'Product Designer');
  assert.equal(ad.company, 'Orbitlabs');
});

test('job boards are never taken as the company', () => {
  assert.equal(companyFromUrl('https://uk.indeed.com/viewjob?jk=1'), '');
  assert.equal(companyFromUrl('https://boards.greenhouse.io/acme/jobs/1'), '');
  assert.equal(companyFromUrl('not a url'), '');
});

test('an empty page fills nothing', () => {
  assert.deepEqual(parseJobAd('', '').filled, []);
});

test('decode handles numeric and named entities', () => {
  assert.equal(decode('&pound;40k &ndash; &#163;50k &#x26; more'), '£40k – £50k & more');
});
