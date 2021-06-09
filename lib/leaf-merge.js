/**
 * @file        leaf-merge.js
 *              Routine for merging objects graphs at the property level
 *
 * @author      Wes Garland, wes@page.ca
 * @date        Dec 2020
 */

/** 
 * Merge objects at their leaves, combining intermediary objects as necessary. 
 * Arrays are treated as units, not objects. Any number of objects may be specified
 * on the argument vector. The objects on the left are considered to have lower
 * precedence (replaced more easily) than objects on the right. 
 *
 * @examples
 * leafMerge({a:1}, {a:2})              => {a:1}
 * leafMerge({a:1}, {b:2})              => {a:1, b:2}
 * leafMerge({a:{b:1}}, {a:{b:2}})      => {a:{b:1}}
 * leafMerge({a:{b:1}}, {b:{c:2}})      => {a:{b:1}}
 * leafMerge({a:{b:1}}, {a:{c:2}})      => {a:{b:1, c:2}}
 *
 * @param [...] Objects to merge
 * @returns new object
 */
exports.leafMerge = function utils$$objMerge$leafMerge() {
  var target = {};
  
  for (let i=0; i < arguments.length; i++) {
    let neo = arguments[i];
    if (neo === undefined)
      continue;
    
    for (let prop in neo) {
      if (!neo.hasOwnProperty(prop))
        continue;
      if (typeof neo[prop] === 'object' && neo[prop] !== null && !Array.isArray(neo[prop]) && ['Function','Object'].includes(neo[prop].constructor.name)) {
        target[prop] = exports.leafMerge(target[prop], neo[prop]);
      } else {
        target[prop] = neo[prop];
      }
    }
  }

  return target;
}
