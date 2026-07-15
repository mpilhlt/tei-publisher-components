/* eslint-disable class-methods-use-this */
import { Registry } from './registry.js';

/**
 * A tiny subset of the Reconciliation Service API (https://reconciliation-api.github.io/specs/)
 * that this connector needs to speak, covering both the 0.2 and 1.0-draft protocol
 * versions. The two differ in query batch shape, result batch shape, and how a
 * manifest advertises its `view`/`preview` URL templates.
 */

async function getServiceManifest(endpoint) {
  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`Reconciliation service manifest request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

/**
 * Decide which protocol version to speak to this service.
 *
 * Prefer the most recent version the manifest's `versions` array advertises. Some
 * real-world 0.2 services omit `versions` entirely (it only became mandatory with
 * 1.0-draft), so fall back to sniffing the manifest shape: 1.0-draft requires a
 * `view` object, 0.2 requires `identifierSpace`/`schemaSpace`.
 */
function detectVersion(manifest) {
  const versions = Array.isArray(manifest?.versions) ? manifest.versions : [];
  if (versions.includes('1.0-draft') || versions.includes('1.0')) {
    return '1.0-draft';
  }
  if (versions.includes('0.2') || versions.includes('0.1')) {
    return '0.2';
  }
  if (manifest?.identifierSpace || manifest?.schemaSpace) {
    return '0.2';
  }
  return '1.0-draft';
}

/**
 * Replace a manifest URL template's id placeholder, whether written as the strict
 * 0.2 `{{id}}` or the looser 1.0-draft `{id}`/`{...id...}` pattern.
 */
function expandUrlTemplate(template, id) {
  const encoded = encodeURIComponent(id);
  if (template.includes('{{id}}')) {
    return template.replace('{{id}}', encoded);
  }
  return template.replace(/\{[^{}]*id[^{}]*\}/, encoded);
}

function buildQueryOneDraft(key, type, limit) {
  const query = {
    conditions: [{ matchType: 'name', propertyValue: key }],
  };
  if (type) query.type = type;
  if (limit) query.limit = Number(limit);
  return {
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ queries: [query] }),
    },
  };
}

function buildQueryZeroTwo(key, type, limit) {
  const query = { query: key };
  if (type) query.type = type;
  if (limit) query.limit = Number(limit);
  return {
    init: {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ queries: JSON.stringify({ q0: query }) }),
    },
  };
}

/**
 * Extract the ordered list of candidates from a result batch, regardless of
 * protocol version: 1.0-draft returns `{ results: [{ candidates }] }` (one entry
 * per submitted query, in order — this connector always submits exactly one);
 * 0.2 returns `{ q0: { result } }` (keyed by the query id we chose, "q0").
 */
function extractCandidates(version, json) {
  if (version === '1.0-draft') {
    return json?.results?.[0]?.candidates ?? [];
  }
  return json?.q0?.result ?? [];
}

export class ReconciliationService extends Registry {
  constructor(configElem) {
    super(configElem);
    this.endpoint = configElem.getAttribute('endpoint');
    this.debug = configElem.hasAttribute('debug');
    this.type = configElem.getAttribute('type') || this._register;
    this.limit = configElem.getAttribute('limit');
    this._manifestReady = getServiceManifest(this.endpoint)
      .then(manifest => {
        this.manifest = manifest;
        this.version = detectVersion(manifest);
        if (this.debug) {
          console.log(
            "Reconciliation connector for register '%s' at <%s>: negotiated version '%s'. Manifest: %o",
            this._register,
            this.endpoint,
            this.version,
            manifest,
          );
        }
      })
      .catch(error => {
        console.error('Failed to load reconciliation service manifest from %s: %o', this.endpoint, error);
        this.manifest = {};
        this.version = '1.0-draft';
      });
  }

  /**
   * Query the authority and return a RegistryResult.
   *
   * @param {String} key the search string
   */
  async query(key) {
    await this._manifestReady;
    const { init } = this.version === '1.0-draft'
      ? buildQueryOneDraft(key, this.type, this.limit)
      : buildQueryZeroTwo(key, this.type, this.limit);

    const response = await fetch(this.endpoint, init);
    if (!response.ok) {
      throw new Error(`Reconciliation query failed: ${response.status} ${response.statusText}`);
    }
    const json = await response.json();
    const candidates = extractCandidates(this.version, json);

    const results = candidates.map(item => {
      let details;
      if (item.description) {
        details = item.description;
      } else if (Array.isArray(item.type)) {
        details = item.type.map(t => (typeof t === 'string' ? t : t.name)).join(', ');
      } else {
        details = '';
      }
      const link = this.manifest?.view?.url ? expandUrlTemplate(this.manifest.view.url, item.id) : item.id;
      return {
        register: this._register,
        id: this._prefix ? `${this._prefix}-${item.id}` : item.id,
        label: item.name,
        link,
        details,
        provider: 'Reconciliation',
      };
    });

    if (this.debug) {
      console.log('Reconciliation results (%s): %o', this.version, results);
    }
    return {
      totalItems: results.length,
      items: results,
    };
  }

  /**
   * Retrieve information about a registry entry and display it
   * using the given container.
   *
   * @param {String} id the id to look up
   * @param {HTMLElement} container reference to an element which should be used as container for displaying the information
   * @returns {Promise} a promise
   */
  async info(id, container) {
    if (!id) {
      return {};
    }
    await this._manifestReady;
    const rawId = this._prefix ? id.substring(this._prefix.length + 1) : id;

    // 1.0-draft only requires manifest.preview to carry width/height, not a url — the
    // preview page itself lives at the fixed "<endpoint>/preview?id=..." sub-path.
    // Some services (incl. our own reconcile profile) also emit preview.url directly,
    // for both versions; prefer it when present, else fall back to the 1.0-draft
    // convention, else give up gracefully.
    let previewUrl;
    if (this.manifest?.preview?.url) {
      previewUrl = expandUrlTemplate(this.manifest.preview.url, rawId);
    } else if (this.manifest?.preview && this.version === '1.0-draft') {
      previewUrl = `${this.endpoint.replace(/\/$/, '')}/preview?id=${encodeURIComponent(rawId)}`;
    }

    if (!previewUrl) {
      container.innerHTML = "no 'preview' information in endpoint's manifest";
      return {};
    }

    try {
      const response = await fetch(previewUrl);
      const output = await response.text();
      container.innerHTML = output;
      return {
        id: this._prefix ? `${this._prefix}-${rawId}` : rawId,
      };
    } catch (error) {
      container.innerHTML = 'failed to load preview';
      throw error;
    }
  }
}
