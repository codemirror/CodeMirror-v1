/* A few useful utility functions. */

// Retrieve the next value from an iterator, or return an alternative
// value if the iterator is at its end.
function nextOr(iter, alternative){
  try {
    return iter.next();
  }
  catch (e) {
    if (e != StopIteration)
      throw e;
    else return alternative;
  }
}

// Create a predicate function that tests a string againsts a given
// regular expression.
function matcher(regexp){
  return function(value){return regexp.test(value);};
}

// Test whether a DOM node has a certain CSS class. Much faster than
// the MochiKit equivalent, for some reason.
function hasClass(element, className){
  var classes = element.className;
  return classes && new RegExp("(^| )" + className + "($| )").test(classes);
}

// Insert a DOM node after another node.
function insertAfter(newNode, oldNode) {
  var parent = oldNode.parentNode;
  var next = oldNode.nextSibling;
  if (next)
    parent.insertBefore(newNode, next);
  else
    parent.appendChild(newNode);
  return newNode;
}

// Insert a dom node at the start of a container.
function insertAtStart(node, container) {
  if (container.firstChild)
    container.insertBefore(node, container.firstChild);
  else
    container.appendChild(node);
  return node;
}

// Check whether a node is contained in another one.
function isAncestor(node, child) {
  while (child = child.parentNode) {
    if (node == child)
      return true;
  }
  return false;
}

// The non-breaking space character.
var nbsp = String.fromCharCode(160);
// Unfortunately, IE's regexp matcher thinks non-breaking spaces
// aren't whitespace.
var realWhiteSpace = new RegExp("^[\\s" + nbsp + "]*$");

// Produces a function that checks a MochiKit key event and returns a
// boolean indicating whether the relevant key is part of the given
// set. Arguments should be strings corresponding to MochiKit key
// strings, without the "KEY_" prefix, and can optionally be prefixed
// by modifiers ("ctrl", "alt", "shift") separated by spaces. Thus
// "ctrl TAB" refers control-tab.
function keySet() {
  var check = function() {return false;};
  var set = {};
  forEach(arguments, function(keydesc) {
    var next = check;
    var parts = keydesc.split(" ");
    var _name = "KEY_" + parts[parts.length - 1];
    var _mods = parts.slice(0, parts.length - 1);
    set[_name] = true;
    check = function(name, mods) {
      return (name == _name && every(_mods, function(m){return mods[m];})) || next(name, mods);
    };
  });
  return function(event) {
    var name = event.key().string;
    return set.hasOwnProperty(name) && check(name, event.modifier());
  };
}
