/* eslint-disable class-methods-use-this */
import { semver } from 'semver'
import { Registry } from './registry.js'

// TODO:
// - be more robust with differences between API versions
// - more fields reconc service <-> TEI Publisher
// - strings <- types
// - use scheme#types in @type output?
// - test with other providers
// - use/test inside custom connector
// - documentation

/**
 * Return a JSON object representing the reconciliation service manifest
 *
 * @param {String} endpoint - the service to request the manifest of
 * @returns {Promise}       - a promise
 */
async function getServiceManifest (endpoint) {
	const response = await fetch(endpoint);
	const data = await response.json();
  return data;
}

/**
 * Return a JSON object to query the service, depending on what version the service supports
 *
 * @param {String} version - the requested reconciliation API version
 * @param {String} key     - the query expression
 * @returns {object}       - a json object
 */
function queryObj(version, key) {
  switch (version) {
    case '0.3-alpha':
      return {
        queries: [{
          query: key
        }]
      };
    default:
      return {
        q0: {
          query: key
        }
      };
  }
}

/**
 * Return a JSON requestInit object to pass to fetch() for querying the service
 *
 * @param {String} version - the requested reconciliation API version
 * @param {String} key     - the query expression
 * @returns {RequestInit}  - a json object
 */
function qRequestInit(version, key) {
  switch (version) {
    case '0.3-alpha':
      return {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: queryObj(version, key)
      };
    default:
      return {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: "queries=".concat(JSON.stringify(queryObj(version, key)))
      };
  }
}

export class ReconciliationService extends Registry {
  constructor(configElem) {
    super(configElem)
    this.endpoint = configElem.getAttribute('endpoint');
    this.debug = configElem.getAttribute('debug');
    this.processLang = configElem.getAttribute('processlang');
    this.acceptLang = configElem.getAttribute('acceptlang');
    getServiceManifest(this.endpoint)
      .then((result) => {
        this.ReconcConfig = result;
        // check out the largest of the versions that the endpoint supports (that is not larger than what this client supports)
        this.reconcVersion = !this.ReconcConfig.versions ? "0.1" : semver.maxSatisfying(this.ReconcConfig.versions, "<=0.2" );
        if (this.debug) {
          console.log(
            'Reconciliation connector for register \'%s\' at endpoint <%s> (v%s).',
            this._register, this.endpoint, this.reconcVersion
          );
          if (this.processLang || this.acceptLang) {
            console.log('Using processLang %s and acceptLang %s.', this.processLang, this.acceptLang );
          }
          console.log('Using config: %o', this.ReconcConfig);
        }
      })
  }

  /**
   * Query the authority and return a RegistryResult.
   *
   * @param {String} key - the search string
   * @returns {Promise}  - a promise
   */
  async query(key) {
    const qInit = qRequestInit(this.reconcVersion, key);
    if (this.acceptLang && this.reconcVersion === '0.3-alpha') {
      qInit.headers["Accept-Language"] = this.acceptLang
    }
    if (this.processLang && this.reconcVersion === '0.3-alpha') {
      qInit.body.queries[0].lang = this.processLang
    }
    return ( fetch(this.endpoint, qInit)
              .then((response) => response.json())
              .then((json) => this._parseResponse(json))
           )
  }

  /**
   * Retrieve information about a registry entry and display it
   * using the given container.
   *
   * @param {String} id             - the id to look up
   * @param {HTMLElement} container - reference to an element which should be used as container for displaying the information
   * @returns {Promise}             - a promise
   */
  info(id, container) {
    if (!id) {
      return Promise.resolve({});
    }
    if (!this.ReconcConfig.preview) {
      container.innerHTML = 'no \'preview\' endpoint in reconciliation service\'s manifest';
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const rawid = this._prefix ? id.substring(this._prefix.length + 1) : id;
      const url = this.ReconcConfig.preview.url.replace('{{id}}', encodeURIComponent(rawid));
      fetch(url)
      .then(response => response.text())
      .then((output) => {
        container.innerHTML = output;
        resolve({
          id: this._prefix ? `${this._prefix}-${rawid}` : rawid
        });
      })
      .catch(() => reject());
    });
  }

  /**
   * Retrieve a raw JSON record for the given key as returned by the endpoint.
   * 
   * @param {string} key     - key the key to look up
   * @returns {Promise<any>} - promise resolving to the JSON record returned by the endpoint
   */
  async getRecord(key) {
    const id = this._prefix ? key.substring(this._prefix.length + 1) : key;
    let viewUrl = '';
    if (this.ReconcConfig.view) {
      viewUrl = this.ReconcConfig.view.url.replace('{{id}}', id);
    } else {
      return Promise.reject()
    }
    return fetch(`${viewUrl}.json`)
      .then((response) => {
        if (response.ok) {
          return response.json();
        }
        return Promise.reject();
      })
      .then((json) => {
        const output = { ... json};
        output.name = json.prefLabel;
        output.link = viewUrl;
        return output;
      })
      .catch(() => Promise.reject());
  }

  /**
   * Parse the response of a reconciliation service
   *
   * @param {String} version  - the requested reconciliation API version
   * @param {Object} obj - the response to be parsed
   * @returns {Object}   - a json object
   */
  _parseResponse(version, obj) {
    const results = [];
    switch (version) {
      case '0.3-alpha':
        obj.results[0].candidates.forEach((item) => {
          if (this.ReconcConfig.view) {
            this.view = this.ReconcConfig.view.url.replace('{{id}}', item.id);
          } else {
            this.view = item.id;
          }
          if (item.description) {
            this.description = item.description;
          } else if (item.type) {
            this.description = item.type.map(t => t.name.toString() ).join(', ');
          } else {
            this.description = "";
          }
          const result = {
              register: this._register,
              id: (this._prefix ? `${this._prefix}-${item.id}` : item.id),
              label: item.name,
              type: item.type,
              details: this.description,
              score: item.score,
              link: this.view,
              provider: 'Reconciliation'
          };
          results.push(result);
        });
        if (this.debug) {
          console.log('Reconciliation has %s results: %o', obj.results[0].candidates.length, results);
        }
        return {
          totalItems: obj.results[0].candidates.length,
          items: results,
        };
      default:
        obj.q0.result.forEach((item) => {
          if (this.ReconcConfig.view) {
            this.view = this.ReconcConfig.view.url.replace('{{id}}', item.id);
          } else {
            this.view = item.id;
          }
          if (item.description) {
            this.description = item.description;
          } else if (item.type) {
            this.description = item.type.map(t => t.name.toString() ).join(', ')
          } else {
            this.description = ""
          }
          const result = {
              register: this._register,
              id: (this._prefix ? `${this._prefix}-${item.id}` : item.id),
              label: item.name,
              type: item.type,
              details: this.description,
              link: this.view,
              provider: 'Reconciliation'
          };
          results.push(result);
        });
        if (this.debug) {
          console.log('Reconciliation has %s results: %o', obj.q0.result.length, results);
        }
        return {
            totalItems: obj.q0.result.length,
            items: results,
        };
    }
  }

}
