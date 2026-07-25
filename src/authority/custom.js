import { Registry } from './registry.js';
// eslint-disable-next-line import/no-cycle
import { createConnectors } from './connectors.js';

/**
 * Combines this app's own local register with one or more nested connectors (configured as
 * child <pb-authority> elements, see connectors.js's createConnectors()) into a single
 * federated authority: search hits from both sources, viewing/selecting an entry prefers the
 * local register copy but falls back to whichever nested connector actually has the data, and
 * selecting an external (non-local) match copies it into the local register so it becomes an
 * editable, citable local entry from then on. This is what lets e.g. "person" search GND and a
 * reconciliation service alongside the local KBGA register with one unified candidate list.
 */
export class Custom extends Registry {
  constructor(endpoint, configElem) {
    super(configElem);
    this._editable = configElem.hasAttribute('edit');
    this._endpoint = endpoint;
    this._connectors = createConnectors(endpoint, configElem);
    this._connectors.forEach(connector => {
      connector.name = this.name;
    });
    console.log(
      'custom connector: endpoint: %s; using authorities: %o',
      this._endpoint,
      this._connectors,
    );
  }

  get editable() {
    return this._editable;
  }

  /**
   * Search the local register first, then every nested connector in turn, merging all results
   * into one list. A nested-connector hit whose id already appeared in the local results is
   * dropped (`localResults`) so the same entity doesn't show up twice just because it's both
   * registered locally and independently findable via e.g. GND.
   */
  async query(key) {
    return new Promise(resolve => {
      fetch(
        `${this._endpoint}/api/register/search/${this._register}?query=${encodeURIComponent(key)}`,
      )
        .then(response => response.json())
        .then(async json => {
          let results = [];
          const localResults = new Set();
          json.forEach(item => {
            results.push({
              register: this._register,
              id: item.id,
              label: item.label,
              link: item.link,
              details: item.details,
              provider: 'local',
            });
            localResults.add(item.id);
          });
          let totalItems = json.length;

          for (const connector of this._connectors) {
            // eslint-disable-next-line no-await-in-loop
            const dr = await connector.query(key);
            results = results.concat(dr.items.filter(result => !localResults.has(result.id)));
            totalItems += dr.totalItems;
          }
          resolve({
            totalItems,
            items: results,
          });
        });
    });
  }

  /**
   * Look up `key` in the local register first; only if that 404s (not registered locally, e.g.
   * an id copied straight out of a search result the user hasn't selected/saved yet) does it
   * fall through to asking each nested connector's own info() in turn, so a match that only
   * exists externally still gets a working preview.
   */
  info(key, container) {
    if (!key) {
      return Promise.resolve({});
    }
    const id = key;
    return new Promise((resolve, reject) => {
      fetch(`${this._endpoint}/api/register/${this._register}/${encodeURIComponent(id)}`).then(
        async response => {
          if (response.ok) {
            const json = await response.json();
            container.innerHTML = json.details;
            resolve({
              id: json.id,
              strings: json.strings,
              editable: this._editable,
            });
            return;
          }
          if (response.status === 404) {
            for (const connector of this._connectors) {
              try {
                // eslint-disable-next-line no-await-in-loop
                const cr = await connector.info(key, container);
                if (cr) {
                  resolve(cr);
                }
              } catch (e) {
                // not found: continue
              }
            }
          }
          reject();
        },
      );
    });
  }

  /**
   * Called when the user picks a candidate from the merged query() list. If `item` came from a
   * nested connector rather than the local register, fetch its full record (first connector
   * whose getRecord() succeeds - see the id-prefix caveat on ReconciliationService/GND's own
   * getRecord()) and POST it into the local register's own API, turning a one-off external match
   * into a permanent, editable local entry. If no nested connector can produce a record (e.g.
   * `item` was already a local-register result), just pass it through unchanged.
   *
   * @param {any} item
   * @returns {Promise}
   */
  async select(item) {
    let entry;
    for (const connector of this._connectors) {
      // eslint-disable-next-line no-await-in-loop
      entry = await connector.getRecord(item.id).catch(() => null);
      if (entry) {
        break;
      }
    }
    if (!entry) {
      return Promise.resolve(item);
    }
    return fetch(
      `${this._endpoint}/api/register/${this._register}/${encodeURIComponent(item.id)}`,
      {
        method: 'POST',
        mode: 'cors',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(entry),
      },
    ).then(response => {
      if (response.ok) {
        return response.json();
      }
      return Promise.reject(Error(response.status.toString()));
    });
  }

  /**
   * Delegate to whichever wrapped sub-connector actually implements data-extension fetching (e.g.
   * a nested ReconciliationService), mirroring how select() above already delegates getRecord() -
   * without this, an `extend:propId` field source in this connector's own `fields` config would
   * silently always resolve to "no value" for every item, since Registry's own default
   * fetchExtend() is a no-op and Custom itself has no extend capability of its own.
   *
   * @param {string} id the id to fetch extended properties for
   * @param {string[]} propertyIds the property ids to fetch
   * @returns {Promise<Object.<string, *>>} promise resolving to a map of propertyId -> value
   */
  async fetchExtend(id, propertyIds) {
    for (const connector of this._connectors) {
      // eslint-disable-next-line no-await-in-loop
      const result = await connector.fetchExtend(id, propertyIds).catch(() => ({}));
      if (result && Object.keys(result).length > 0) {
        return result;
      }
    }
    return {};
  }
}
