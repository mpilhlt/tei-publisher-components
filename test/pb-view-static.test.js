/* eslint-disable no-unused-expressions */
import { fixture, expect } from '@open-wc/testing';

import '../src/pb-document.js';
import '../src/pb-page.js';
import '../src/pb-view.js';

describe('pb-view static data paths', () => {
  it('builds base path from static prefix and document path', async () => {
    const el = await fixture(`
      <pb-page endpoint="/exist/apps/tei-publisher">
        <pb-document id="document1" path="doc/quickstart.xml" odd="docbook" view="div"></pb-document>
        <pb-view src="document1" static="cached"></pb-view>
      </pb-page>
    `);

    const view = el.querySelector('pb-view');
    expect(view._staticDataBase()).to.equal('cached/doc/quickstart.xml');
  });

  it('resolves index and part URLs under the static data base', async () => {
    const el = await fixture(`
      <pb-page endpoint="/exist/apps/tei-publisher">
        <pb-document id="document1" path="doc/quickstart.xml" odd="docbook" view="div"></pb-document>
        <pb-view src="document1" static="cached"></pb-view>
      </pb-page>
    `);

    const view = el.querySelector('pb-view');
    view._endpoint = '/exist/apps/tei-publisher';
    const originalFetch = window.fetch;
    window.fetch = url => {
      expect(String(url)).to.contain('cached/doc/quickstart.xml/index.json');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ 'odd=docbook.odd&view=div': 'a.json' }),
      });
    };

    try {
      const partUrl = await view._staticUrl({ odd: 'docbook.odd', view: 'div' });
      expect(partUrl).to.equal(
        'http://127.0.0.1:9876/exist/apps/tei-publisher/cached/doc/quickstart.xml/a.json',
      );
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('resolves static CSS under the endpoint and static prefix', async () => {
    const el = await fixture(`
      <pb-page endpoint="/exist/apps/tei-publisher">
        <pb-document id="document1" path="doc/quickstart.xml" odd="docbook" view="div"></pb-document>
        <pb-view src="document1" static="cached"></pb-view>
      </pb-page>
    `);

    const view = el.querySelector('pb-view');
    view._endpoint = '/exist/apps/tei-publisher';
    view._updateStyles();

    expect(view._style.getAttribute('href')).to.equal(
      '/exist/apps/tei-publisher/cached/css/docbook.css',
    );
  });

  it('returns null from _staticUrl when index.json is missing', async () => {
    const el = await fixture(`
      <pb-page endpoint="/exist/apps/tei-publisher">
        <pb-document id="document1" path="doc/missing.xml" odd="docbook" view="div"></pb-document>
        <pb-view src="document1" static="cached"></pb-view>
      </pb-page>
    `);

    const view = el.querySelector('pb-view');
    view._endpoint = '/exist/apps/tei-publisher';
    const originalFetch = window.fetch;
    window.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.reject(new Error('not found')),
      });

    try {
      const partUrl = await view._staticUrl({ odd: 'docbook.odd', view: 'div' });
      expect(partUrl).to.equal(null);
      expect(view._staticFallback).to.equal(true);
    } finally {
      window.fetch = originalFetch;
    }
  });

  it('falls back to dynamic loading when static index is missing', async () => {
    const el = await fixture(`
      <pb-page endpoint="/exist/apps/tei-publisher">
        <pb-document id="document1" path="doc/missing.xml" odd="docbook" view="div"></pb-document>
        <pb-view src="document1" static="cached"></pb-view>
      </pb-page>
    `);

    const view = el.querySelector('pb-view');
    view._endpoint = '/exist/apps/tei-publisher';
    view._apiVersion = '1.0.0';

    const loadContent = {
      url: null,
      params: null,
      generateRequest() {},
    };
    view.shadowRoot.getElementById = id => (id === 'loadContent' ? loadContent : null);

    const originalFetch = window.fetch;
    window.fetch = () =>
      Promise.resolve({
        ok: false,
        status: 404,
      });

    try {
      view._updateStyles();
      expect(view._style.getAttribute('href')).to.equal(
        '/exist/apps/tei-publisher/cached/css/docbook.css',
      );

      view._doLoad({ odd: 'docbook.odd', view: 'div' });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(loadContent.url).to.equal(
        '/exist/apps/tei-publisher/api/parts/doc%2Fmissing.xml/json',
      );
      expect(loadContent.params).to.deep.equal({ odd: 'docbook.odd', view: 'div' });
      expect(view._style.getAttribute('href')).to.equal(
        '/exist/apps/tei-publisher/transform/docbook.css',
      );
    } finally {
      window.fetch = originalFetch;
    }
  });
});
