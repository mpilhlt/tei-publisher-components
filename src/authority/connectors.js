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
 * list; `"Metagrid"` is itself one of the valid names, not just the fallback. Anything else
 * (including a typo, e.g. "Reconciliation" instead of "ReconciliationService") still becomes
 * a Metagrid connector - changing that to skip the entry or throw risks either silently
 * dropping a configured authority or crashing an entire federated Custom search over one bad
 * nested connector, neither obviously better than today's behaviour - but it is no longer
 * silent: an unrecognized name is logged loudly so the mistake is visible in devtools instead
 * of just looking like a working authority that happens to query the wrong service.
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
      case 'Metagrid':
        instance = new Metagrid(configElem);
        break;
      default:
        console.error(
          '<pb-authority> connector="%s" is not a recognized connector name - falling back to Metagrid. ' +
            'Check for a typo (the exact, case-sensitive names are GND, GeoNames, Airtable, KBGA, Anton/GF, ' +
            'ReconciliationService, Custom, Metagrid).',
          connector,
        );
        instance = new Metagrid(configElem);
        break;
    }
    authorities.push(instance);
  });
  return authorities;
}
