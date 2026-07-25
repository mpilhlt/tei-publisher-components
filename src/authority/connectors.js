import { Metagrid } from './metagrid.js';
import { GeoNames } from './geonames.js';
import { Airtable } from './airtable.js';
import { GND } from './gnd.js';
import { KBGA } from './kbga.js';
import { Anton } from './anton.js';
import { ReconciliationService } from './reconciliation.js';
import { Custom } from './custom.js';

/**
 * Instantiate one connector per direct `<pb-authority connector="...">` child of `root`
 * (typically a `<pb-authority-lookup>` or, when called from custom.js, a `<pb-authority
 * connector="Custom">` wrapping further nested authorities). `endpoint` is only used by
 * "Custom", which talks to this app's own local register API rather than an external service.
 *
 * The `connector` attribute is matched by exact string, case-sensitively, against a fixed
 * list - anything that doesn't match (including a typo, e.g. "Reconciliation" instead of
 * "ReconciliationService") falls through to `default` and silently becomes a Metagrid
 * connector instead of failing loudly. There's no validation surfacing this at config time; a
 * misconfigured `connector` attribute looks like a working authority that just happens to
 * query the wrong (Metagrid) service.
 */
export function createConnectors(endpoint, root) {
  const authorities = [];
  root.querySelectorAll(':scope > pb-authority').forEach(configElem => {
    const connector = configElem.getAttribute('connector');
    let instance;
    switch (connector) {
      case 'GND':
        instance = new GND(configElem);
        break;
      case 'GeoNames':
        instance = new GeoNames(configElem);
        break;
      case 'Airtable':
        instance = new Airtable(configElem);
        break;
      case 'KBGA':
        instance = new KBGA(configElem);
        break;
      case 'Anton':
      case 'GF':
        instance = new Anton(configElem);
        break;
      case 'ReconciliationService':
        instance = new ReconciliationService(configElem);
        break;
      case 'Custom':
        instance = new Custom(endpoint, configElem);
        break;
      default:
        instance = new Metagrid(configElem);
        break;
    }
    authorities.push(instance);
  });
  return authorities;
}
